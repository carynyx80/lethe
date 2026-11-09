const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();
for(const [f,w,h] of [['profile',400,400],['banner',1500,500]]){
 const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:2});
 await p.goto('file://'+__dirname+'/'+f+'.html');await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(300);
 await p.screenshot({path:__dirname+'/lethe-'+(f=='profile'?'logo':'twitter-header')+'.png',clip:{x:0,y:0,width:w,height:h}});}
await b.close()})();
