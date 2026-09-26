import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
import {desktopIntegrationFixture} from './figma-desktop-integration-fixture.mjs';

export function helpCenterFixture({master=true}={}) {
  const dom=new JSDOM(desktopIntegrationFixture('account',{master,permissions:master?undefined:[]}));
  const doc=dom.window.document;
  const shell=new JSDOM(readFileSync(root+'admin/index.html','utf8'));
  doc.querySelector('.main-shell main').append(doc.importNode(shell.window.document.getElementById('helpSection'),true));
  const style=doc.createElement('style');
  style.textContent=readFileSync(root+'admin/help-center.css','utf8');doc.head.append(style);
  for(const file of ['admin/help-content.js','admin/help-center.js']){
    const script=doc.createElement('script');script.textContent=readFileSync(root+file,'utf8').replaceAll('</script','<\\/script');doc.body.append(script);
  }
  const html=dom.serialize();dom.window.close();shell.window.close();return html;
}
