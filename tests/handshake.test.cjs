const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
for(const kind of ['processor','solver'])test(`${kind} ignores unrelated window messages before accepting its trusted handshake`,()=>{
 const parent={},listeners=new Map(),solver={addEventListener(){},contentWindow:{postMessage(){}}};
 const sandbox={parent,window:{addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name,fn){assert.equal(listeners.get(name),fn);listeners.delete(name);}},document:{getElementById:()=>solver},setTimeout,clearTimeout};
 const file=kind==='processor'?'src/processor.js':'extension/solver.js';let source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 if(kind==='processor')source=source.replace("import {openStream} from './extractor.js';",'const openStream=()=>{};');
 vm.runInNewContext(source,sandbox);const listener=listeners.get('message');
 listener({source:{},origin:'https://www.youtube.com',data:{type:'unrelated'},ports:[]});assert.equal(listeners.get('message'),listener);
 listener({source:parent,origin:'https://malicious.example',data:{type:'unrelated'},ports:[]});assert.equal(listeners.get('message'),listener);
 const port={start(){this.started=true;}};
 listener({source:parent,origin:'https://www.youtube.com',data:{type:kind==='processor'?'bind-surround':'bind-solver'},ports:[port]});
 assert.equal(listeners.has('message'),false);assert.equal(port.started,true);assert.equal(typeof port.onmessage,'function');
});
