import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--headless=new','--allow-file-access-from-files'] });
const p = await b.newPage();
await p.goto('file:///D:/cozyses/build/house.html?autostart=1', { waitUntil: 'load' });
await p.waitForFunction('window.COZY && COZY.ready', { timeout: 60000 });
const r = await p.evaluate(() => { const S = COZY.THREE.ShaderChunk; return { lfb: S.lights_fragment_begin, has: ['standard','physical','phong','lambert','toon'].map(k => !!COZY.THREE.ShaderLib[k]) }; });
console.log(r.lfb); console.log(r.has);
await b.close();
