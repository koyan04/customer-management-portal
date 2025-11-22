const puppeteer = require('puppeteer');
const fs = require('fs');
(async ()=>{
  try{
    const browser = await puppeteer.launch({args: ['--no-sandbox','--disable-setuid-sandbox']});
    const page = await browser.newPage();
    const widths = [420,360,320];
    for(const w of widths){
      await page.setViewport({ width: w, height: 900 });
      await page.goto('http://localhost:5174/', { waitUntil: 'networkidle2', timeout: 10000 });
      await page.waitForTimeout(800);
      const outDir = './screenshots';
      if(!fs.existsSync(outDir)) fs.mkdirSync(outDir);
      const path = `${outDir}/users-${w}.png`;
      await page.screenshot({ path: path, fullPage: true });
      console.log('Saved', path);
    }
    await browser.close();
    process.exit(0);
  }catch(err){
    console.error('Error capturing screenshots', err);
    process.exit(2);
  }
})();