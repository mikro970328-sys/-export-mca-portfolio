import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {homeCommunicationsFixture} from './figma-home-communications-fixture.mjs';
import {tasksWorkersFixture} from './figma-tasks-workers-fixture.mjs';
import {accessAccountFixture} from './figma-access-account-fixture.mjs';
import {directoriesFixture} from './figma-directories-fixture.mjs';
import {logisticsFixture} from './figma-logistics-fixture.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>readFileSync(root+p,'utf8');
export const desktopSections={dashboard:'dashboardSection',alerts:'notificationsSection',clients:'clientsSection',tasks:'tasksSection',workers:'workersSection',access:'adminsSection',account:'accountSection',tracking:'containersSection'};
// Combine the original shell markup/navigation with each real owner and its memory API.
export function desktopIntegrationFixture(module){
 let html;
 if(['dashboard','alerts'].includes(module))html=homeCommunicationsFixture({module});
 else if(['tasks','workers'].includes(module))html=tasksWorkersFixture({module});
 else if(['access','account'].includes(module))html=accessAccountFixture({module,master:true});
 else if(module==='clients')html=directoriesFixture({module});
 else if(module==='tracking')html=logisticsFixture({module});
 else throw Error('Unsupported native workspace');
 const dom=new JSDOM(html),doc=dom.window.document,shellDom=new JSDOM(read('admin/index.html'));
 const app=doc.importNode(shellDom.window.document.getElementById('appShell'),true);app.classList.remove('hidden');
 const main=app.querySelector('main');main.replaceChildren();
 for(const section of [...doc.querySelectorAll('.app-section')])main.append(section);
 doc.querySelectorAll('body>header,body>main').forEach(n=>n.remove());
 doc.querySelectorAll('script').forEach(n=>{if(n.textContent.trim()==='window.showSection=id=>window.__fixtureNavigation.push({section:id});')n.remove();});
 app.querySelectorAll('img').forEach(n=>n.setAttribute('src','data:image/png;base64,'+readFileSync(root+'admin/apple-touch-icon.png').toString('base64')));
 doc.body.prepend(app);
 const style=doc.createElement('style');style.textContent=read('admin/navigation-shell.css');doc.head.append(style);
 doc.querySelector('meta[http-equiv="Content-Security-Policy"]').content+="; frame-src 'self'";
 for(const code of [read('admin/ui-icon-system.js'),read('admin/navigation-shell.js'),`document.addEventListener('DOMContentLoaded',()=>{window.showSection('${desktopSections[module]}');});`]){
  const script=doc.createElement('script');script.textContent=code.replaceAll('</script','<\\/script');doc.body.append(script);
 }
 const result=dom.serialize();dom.window.close();shellDom.window.close();return result;
}
