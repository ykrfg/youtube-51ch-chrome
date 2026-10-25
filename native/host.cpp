// Local-only PCM sink. Audio mode has no file/network access. Explicit installer mode registers this executable.
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <spatialaudioclient.h>
#include <ks.h>
#include <ksmedia.h>
#include <wrl/client.h>
#include <io.h>
#include <fcntl.h>
#include <atomic>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <fstream>
#include <filesystem>
#include <map>
#include <mutex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include "vendor/json.hpp"
using json=nlohmann::json;
using Microsoft::WRL::ComPtr;
constexpr size_t Budget=96*1024*1024;
std::mutex outputMutex;
void send(const json& value){std::lock_guard<std::mutex> lock(outputMutex);auto text=value.dump();uint32_t n=static_cast<uint32_t>(text.size());std::cout.write(reinterpret_cast<char*>(&n),4);std::cout.write(text.data(),n);std::cout.flush();}
void check(HRESULT hr,const char* where){if(FAILED(hr)){std::ostringstream s;s<<where<<" (HRESULT 0x"<<std::hex<<static_cast<uint32_t>(hr)<<")";throw std::runtime_error(s.str());}}
std::vector<uint8_t> unbase64(const std::string& text){
  if(text.size()>400000||text.size()%4)throw std::runtime_error("Invalid PCM block");
  static const std::string alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::vector<uint8_t> out;out.reserve(text.size()/4*3);
  uint32_t value=0;int bits=0;bool padding=false;
  for(char c:text){if(c=='='){padding=true;continue;}auto p=alphabet.find(c);if(padding||p==std::string::npos)throw std::runtime_error("Invalid base64");value=(value<<6)|static_cast<uint32_t>(p);bits+=6;if(bits>=8){bits-=8;out.push_back(static_cast<uint8_t>(value>>bits));}}
  return out;
}
struct Clip{int id=0,rate=48000;double start=0;size_t frames=0;std::vector<float> samples;double end()const{return start+double(frames)/rate;}};
class Store{
public:
  std::map<int,Clip> clips;Clip incoming;std::vector<uint8_t> staging;size_t expected=0;int uploadId=0;
  double position=0,rate=1,volume=1;bool playing=false,muted=false;int current=-1;
  void retain(const std::set<int>& ids){for(auto i=clips.begin();i!=clips.end();)if(!ids.count(i->first))i=clips.erase(i);else ++i;}
  void begin(const json& j){
    int channels=j.at("channels").get<int>();int sr=j.at("sampleRate").get<int>();size_t frames=j.at("frames").get<size_t>();double start=j.at("start").get<double>();
    if(channels!=6||sr<8000||sr>192000||!frames||frames>size_t(sr)*180||!std::isfinite(start)||start<0||frames>Budget/(6*sizeof(float)))throw std::runtime_error("PCM segment exceeds limits");
    incoming=Clip{};incoming.id=j.at("id").get<int>();incoming.rate=sr;incoming.frames=frames;incoming.start=start;uploadId=j.value("uploadId",0);
    expected=frames*6*sizeof(float);staging.clear();staging.reserve(expected);
  }
  void chunk(const json& j){auto bytes=unbase64(j.at("data").get<std::string>());
    if(j.value("uploadId",0)!=uploadId||j.at("id").get<int>()!=incoming.id||!expected||j.at("offset").get<size_t>()!=staging.size()||staging.size()+bytes.size()>expected)throw std::runtime_error("Out-of-order PCM block");
    staging.insert(staging.end(),bytes.begin(),bytes.end());
  }
  void commit(int id){
    if(id!=incoming.id||!expected||staging.size()!=expected)throw std::runtime_error("Incomplete PCM segment");
    incoming.samples.resize(expected/sizeof(float));std::memcpy(incoming.samples.data(),staging.data(),expected);
    for(float& x:incoming.samples)if(!std::isfinite(x))x=0;
    clips[id]=std::move(incoming);expected=0;std::vector<uint8_t>().swap(staging);
    auto bytes=[&](){size_t n=0;for(auto& pair:clips)n+=pair.second.samples.size()*sizeof(float);return n;};
    while(clips.size()>3||bytes()>Budget){
      auto victim=clips.end();double worst=-1;
      for(auto i=clips.begin();i!=clips.end();++i){if(i->first==current)continue;double score=i->first<current?100000+current-i->first:i->first-current;if(score>worst){worst=score;victim=i;}}
      if(victim==clips.end())throw std::runtime_error("PCM cache limit");clips.erase(victim);
    }
  }
  bool sample(double time,std::array<float,6>& result)const{
    for(const auto& pair:clips){const Clip& c=pair.second;if(time<c.start||time>=c.end())continue;
      double point=(time-c.start)*c.rate;size_t index=static_cast<size_t>(point);if(index>=c.frames)continue;
      size_t next=std::min(index+1,c.frames-1);float fraction=static_cast<float>(point-index);
      for(int ch=0;ch<6;ch++)result[ch]=c.samples[index*6+ch]*(1-fraction)+c.samples[next*6+ch]*fraction;
      return true;
    }result.fill(0);return false;
  }
  void state(const json& j){
    const double time=j.at("time").get<double>(),speed=j.at("rate").get<double>(),gain=j.at("volume").get<double>();
    if(!std::isfinite(time)||time<0||!std::isfinite(speed)||speed<0.1||speed>16||!std::isfinite(gain)||gain<0||gain>1)throw std::runtime_error("Invalid playback state");
    bool nextPlaying=j.at("playing").get<bool>();
    if(!playing||!nextPlaying||std::abs(time-position)>0.15||speed!=rate)position=time;
    playing=nextPlaying;rate=speed;volume=gain;muted=j.value("muted",false);current=j.value("current",-1);
  }
};
class AudioEngine{
  ComPtr<ISpatialAudioClient> client;ComPtr<ISpatialAudioObjectRenderStream> stream;
  std::array<ComPtr<ISpatialAudioObject>,6> objects;
  HANDLE eventHandle=nullptr;std::thread thread;std::atomic<bool> quit{false};
public:
  std::mutex mutex;Store store;std::atomic<bool> available{false};unsigned sampleRate=0;std::string error;
  json info(){return {{"type","info"},{"available",available.load()},{"channels",6},{"sampleRate",sampleRate},
    {"engine","Windows Spatial Audio"},{"provider","Windows-selected; Dolby provider is not auto-detected"},{"message",error}};}
  void init(){
    if(available)return;
    try{
      ComPtr<IMMDeviceEnumerator> enumerator;ComPtr<IMMDevice> device;
      check(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&enumerator)),"MMDeviceEnumerator");
      check(enumerator->GetDefaultAudioEndpoint(eRender,eMultimedia,&device),"Default playback device");
      check(device->Activate(__uuidof(ISpatialAudioClient),CLSCTX_INPROC_SERVER,nullptr,reinterpret_cast<void**>(client.GetAddressOf())),"ISpatialAudioClient");
      UINT32 dynamic=0;check(client->GetMaxDynamicObjectCount(&dynamic),"Spatial object count");
      if(!dynamic)throw std::runtime_error("Enable Dolby Atmos for Headphones (or another spatial sound provider) on the default Windows playback device");
      AudioObjectType mask;check(client->GetNativeStaticObjectTypeMask(&mask),"Static channel mask");
      const std::array<AudioObjectType,6> types={AudioObjectType_FrontLeft,AudioObjectType_FrontRight,AudioObjectType_FrontCenter,AudioObjectType_LowFrequency,AudioObjectType_SideLeft,AudioObjectType_SideRight};
      AudioObjectType wanted=AudioObjectType_None;for(auto type:types)wanted|=type;
      if((mask&wanted)!=wanted)throw std::runtime_error("The spatial output does not expose all six 5.1 speaker positions");
      ComPtr<IAudioFormatEnumerator> formats;check(client->GetSupportedAudioObjectFormatEnumerator(&formats),"Spatial formats");
      UINT32 count=0;check(formats->GetCount(&count),"Spatial format count");WAVEFORMATEX* selected=nullptr;
      for(UINT32 i=0;i<count;i++){WAVEFORMATEX* f=nullptr;check(formats->GetFormat(i,&f),"Spatial format");
        const bool floating=f->wFormatTag==WAVE_FORMAT_IEEE_FLOAT||(f->wFormatTag==WAVE_FORMAT_EXTENSIBLE&&f->cbSize>=22&&IsEqualGUID(reinterpret_cast<WAVEFORMATEXTENSIBLE*>(f)->SubFormat,KSDATAFORMAT_SUBTYPE_IEEE_FLOAT));
        if(floating&&f->nChannels==1&&f->wBitsPerSample==32&&f->nSamplesPerSec>=8000&&f->nSamplesPerSec<=192000){selected=f;break;}}
      if(!selected)throw std::runtime_error("No floating-point mono spatial format is available");sampleRate=selected->nSamplesPerSec;
      eventHandle=CreateEventW(nullptr,FALSE,FALSE,nullptr);if(!eventHandle)throw std::runtime_error("Cannot create audio event");
      SpatialAudioObjectRenderStreamActivationParams params={};params.ObjectFormat=selected;params.StaticObjectTypeMask=wanted;
      params.MinDynamicObjectCount=0;params.MaxDynamicObjectCount=0;params.Category=AudioCategory_Media;params.EventHandle=eventHandle;
      PROPVARIANT activation={};activation.vt=VT_BLOB;activation.blob.cbSize=sizeof(params);activation.blob.pBlobData=reinterpret_cast<BYTE*>(&params);
      check(client->ActivateSpatialAudioStream(&activation,__uuidof(ISpatialAudioObjectRenderStream),reinterpret_cast<void**>(stream.GetAddressOf())),"Activate spatial stream");
      for(size_t i=0;i<6;i++)check(stream->ActivateSpatialAudioObject(types[i],&objects[i]),"Activate static 5.1 channel");
      check(stream->Start(),"Start spatial stream");available=true;error.clear();
      thread=std::thread([this](){render();});
    }catch(const std::exception& e){error=e.what();available=false;}
  }
  void render(){
    CoInitializeEx(nullptr,COINIT_MULTITHREADED);
    while(!quit){
      if(WaitForSingleObject(eventHandle,100)!=WAIT_OBJECT_0||quit)continue;
      UINT32 dynamic=0,frames=0;HRESULT hr=stream->BeginUpdatingAudioObjects(&dynamic,&frames);
      if(FAILED(hr)){available=false;send({{"type","device-error"},{"message","The Windows spatial audio device changed or stopped. Switch mode and reconnect."}});break;}
      std::array<float*,6> outputs={};bool valid=true;
      for(size_t ch=0;ch<6;ch++){BYTE* buffer=nullptr;UINT32 size=0;hr=objects[ch]->GetBuffer(&buffer,&size);
        if(FAILED(hr)||size<frames*sizeof(float)){valid=false;break;}outputs[ch]=reinterpret_cast<float*>(buffer);std::memset(buffer,0,size);}
      if(valid){std::lock_guard<std::mutex> lock(mutex);
        for(UINT32 i=0;i<frames;i++)if(store.playing){std::array<float,6> values;store.sample(store.position,values);
          const float gain=store.muted?0:static_cast<float>(store.volume);for(int ch=0;ch<6;ch++)outputs[ch][i]=values[ch]*gain;
          store.position+=store.rate/sampleRate;}}
      hr=stream->EndUpdatingAudioObjects();if(!valid||FAILED(hr)){available=false;send({{"type","device-error"},{"message","Spatial audio rendering failed; standard audio is restored."}});break;}
    }CoUninitialize();
  }
  ~AudioEngine(){quit=true;if(eventHandle)SetEvent(eventHandle);if(thread.joinable())thread.join();if(stream)stream->Stop();for(auto& o:objects)o.Reset();stream.Reset();client.Reset();if(eventHandle)CloseHandle(eventHandle);}
};
void selfTest(){
  Store s;json begin={{"id",0},{"channels",6},{"sampleRate",48000},{"frames",2},{"start",10.0}};s.begin(begin);
  const float known[]={1,2,3,4,5,6,2,3,4,5,6,7};s.staging.resize(sizeof(known));std::memcpy(s.staging.data(),known,sizeof(known));s.commit(0);
  std::array<float,6> out;if(!s.sample(10.0,out)||out[0]!=1||out[5]!=6)throw std::runtime_error("Channel order failed");
  if(!s.sample(10.0+0.5/48000,out)||std::abs(out[2]-3.5f)>0.001)throw std::runtime_error("Resampling failed");
  if(s.sample(9.0,out))throw std::runtime_error("Out-of-range sample failed");
  if(unbase64("AAECAw==")!=std::vector<uint8_t>({0,1,2,3}))throw std::runtime_error("Base64 failed");
  bool rejected=false;try{s.begin({{"id",1},{"channels",2},{"sampleRate",48000},{"frames",2},{"start",0}});}catch(...){rejected=true;}
  if(!rejected)throw std::runtime_error("Channel count validation failed");
  std::cout<<json({{"selfTest","PASS"},{"checks",5}}).dump()<<std::endl;
}
void install(bool remove){
  wchar_t module[32768];DWORD n=GetModuleFileNameW(nullptr,module,32768);if(!n||n>=32768)throw std::runtime_error("Cannot locate executable");
  const auto folder=std::filesystem::path(module).parent_path();const auto manifestPath=folder/L"jp.local.youtube_surround_audio.json";
  const std::wstring host=L"jp.local.youtube_surround_audio";
  const std::array<std::wstring,2> keys={L"Software\\Google\\Chrome\\NativeMessagingHosts\\"+host,L"Software\\Microsoft\\Edge\\NativeMessagingHosts\\"+host};
  if(remove){for(const auto& key:keys){LSTATUS code=RegDeleteKeyW(HKEY_CURRENT_USER,key.c_str());if(code!=ERROR_SUCCESS&&code!=ERROR_FILE_NOT_FOUND)throw std::runtime_error("Cannot remove native host registration");}std::cout<<"Native audio host unregistered for Chrome and Edge."<<std::endl;return;}
  auto utf8=[](const std::wstring& w){int size=WideCharToMultiByte(CP_UTF8,0,w.data(),static_cast<int>(w.size()),nullptr,0,nullptr,nullptr);std::string s(size,'\0');WideCharToMultiByte(CP_UTF8,0,w.data(),static_cast<int>(w.size()),&s[0],size,nullptr,nullptr);return s;};
  std::ifstream idFile(folder/L"extension-id.txt");std::string id;idFile>>id;
  if(id.size()!=32||id.find_first_not_of("abcdefghijklmnop")!=std::string::npos)throw std::runtime_error("extension-id.txt is missing or invalid");
  json manifest={{"name","jp.local.youtube_surround_audio"},{"description","YouTube Original 5.1 Windows Spatial Audio output"},{"path",utf8(module)},
    {"type","stdio"},{"allowed_origins",json::array({"chrome-extension://"+id+"/"})}};
  std::ofstream file(manifestPath,std::ios::binary);if(!file)throw std::runtime_error("Cannot write host manifest");file<<manifest.dump(2);file.close();
  for(const auto& key:keys){HKEY opened=nullptr;LSTATUS code=RegCreateKeyExW(HKEY_CURRENT_USER,key.c_str(),0,nullptr,0,KEY_SET_VALUE,nullptr,&opened,nullptr);
    if(code!=ERROR_SUCCESS)throw std::runtime_error("Cannot register native host");const auto value=manifestPath.wstring();code=RegSetValueExW(opened,nullptr,0,REG_SZ,reinterpret_cast<const BYTE*>(value.c_str()),static_cast<DWORD>((value.size()+1)*sizeof(wchar_t)));RegCloseKey(opened);if(code!=ERROR_SUCCESS)throw std::runtime_error("Cannot write native host registration");}
  std::cout<<"Installed for this Windows user (Chrome and Edge). Extension ID: "<<id<<"\nKeep this folder in place. Reload YouTube and choose Windows Spatial Audio (Dolby / DTS)."<<std::endl;
}
int main(int argc,char** argv){
  _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);
  try{
    if(argc>1&&std::string(argv[1])=="--self-test"){selfTest();return 0;}
    if(argc>1&&std::string(argv[1])=="--install"){install(false);return 0;}
    if(argc>1&&std::string(argv[1])=="--uninstall"){install(true);return 0;}
    struct ComScope{ComScope(){check(CoInitializeEx(nullptr,COINIT_MULTITHREADED),"COM");}~ComScope(){CoUninitialize();}} com;
    AudioEngine engine;
    if(argc>1&&std::string(argv[1])=="--probe"){engine.init();std::cout<<engine.info().dump()<<std::endl;return 0;}
    for(;;){uint32_t n=0;if(!std::cin.read(reinterpret_cast<char*>(&n),4))break;if(!n||n>1024*1024)break;
      std::string text(n,'\0');if(!std::cin.read(&text[0],n))break;
      try{auto j=json::parse(text);std::string type=j.at("type").get<std::string>();
        if(type=="init"){engine.init();send(engine.info());continue;}
        std::lock_guard<std::mutex> lock(engine.mutex);
        if(type=="state")engine.store.state(j);
        else if(type=="pause")engine.store.playing=false;
        else if(type=="abort"){engine.store.expected=0;std::vector<uint8_t>().swap(engine.store.staging);}
        else if(type=="retain"){std::set<int> ids;for(const auto& id:j.at("ids")){if(ids.size()>=3)throw std::runtime_error("Too many retained clips");ids.insert(id.get<int>());}engine.store.retain(ids);}
        else if(type=="begin")engine.store.begin(j);
        else if(type=="chunk")engine.store.chunk(j);
        else if(type=="commit"){int id=j.at("id").get<int>();if(j.value("uploadId",0)!=engine.store.uploadId)throw std::runtime_error("Stale upload");engine.store.commit(id);send({{"type","cached"},{"id",id},{"uploadId",engine.store.uploadId}});}
        else if(type=="stats"){send({{"type","stats"},{"clips",engine.store.clips.size()},{"position",engine.store.position},{"playing",engine.store.playing}});}
        else throw std::runtime_error("Unsupported command");
      }catch(const std::exception& e){send({{"type","error"},{"message",e.what()}});}
    }
  }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}return 0;
}
