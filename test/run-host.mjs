import {runTests} from '@vscode/test-electron';
import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
const root = path.resolve('.');
const directory = await fs.mkdtemp(path.join(os.tmpdir(),'down-marker-test-'));
const socket = net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const executable = process.env.VSCODE_EXECUTABLE_PATH;
const host = runTests({
  ...(executable?{vscodeExecutablePath:executable}:{}),
  extensionDevelopmentPath:root,extensionTestsPath:path.join(root,'dist/test/host.js'),
  extensionTestsEnv:{DOWN_MARKER_TEST_DIR:directory},
  launchArgs:[`--user-data-dir=${path.join(directory,'profile')}`,`--extensions-dir=${path.join(directory,'extensions')}`,`--remote-debugging-port=${port}`,'--disable-extension','github.copilot-chat','--skip-welcome','--skip-release-notes','--disable-workspace-trust','--disable-telemetry',directory],
});
// Propagate failure without an unhandled rejection during browser startup.
let hostError;host.catch(error=>{hostError=error;});
let browser;
try {
  for (let i=0;i<180;i++) {if(hostError)throw hostError;try {await fs.access(path.join(directory,'ready.json'));break;}catch{await new Promise(r=>setTimeout(r,500));}}
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context=browser.contexts()[0];
  const page=context.pages().find(p=>p.url().includes('workbench')) ?? context.pages()[0];
  page.on('pageerror', e=>console.error('Workbench page error:',e.message));
  let notebookFrame;
  for(let i=0;i<120;i++) {
    notebookFrame=page.frames().find(f=>f.url().includes('webview'));
    for(const frame of page.frames()) if(await frame.locator('#preview').count().catch(()=>0)) {notebookFrame=frame;break;}
    if(notebookFrame && await notebookFrame.locator('#preview strong').count().catch(()=>0)) break;
    await new Promise(r=>setTimeout(r,250));
  }
  if(!notebookFrame)throw new Error('No notebook renderer frame found');
  await notebookFrame.locator('#preview strong').first().waitFor({timeout:15000});
  await notebookFrame.locator('#preview strong').first().click({trial:true});
  // Wait for the notebook layout animation to settle before using screen coordinates.
  let previousBox = '';
  for (let i=0;i<20;i++) {
    const box = JSON.stringify(await notebookFrame.locator('#preview strong').first().boundingBox());
    if (box === previousBox) break; previousBox = box;
    await new Promise(r=>setTimeout(r,200));
  }
  const strongBox = await notebookFrame.locator('#preview strong').first().boundingBox();
  const codeBox = await notebookFrame.locator('#preview code').first().boundingBox();
  if (!strongBox || !codeBox) throw new Error('Rendered text is not visible');
  await page.mouse.move(strongBox.x + 1, strongBox.y + strongBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(codeBox.x + codeBox.width, codeBox.y + codeBox.height / 2, {steps:15});
  await page.mouse.up();
  await notebookFrame.getByRole('button',{name:'Add or edit a note'}).click();
  let sidebar;
  for(let i=0;i<100;i++) {
    for(const frame of page.frames()) if(await frame.locator('#list textarea').count().catch(()=>0)) {sidebar=frame;break;}
    if(sidebar)break;await new Promise(r=>setTimeout(r,200));
  }
  if(!sidebar)throw new Error('Annotations sidebar did not open');
  await sidebar.locator('#list textarea').first().fill('Remember this insight.\nA second line.');
  await sidebar.locator('#list select').first().selectOption('blue');
  await sidebar.getByRole('button',{name:'Save note',exact:true}).first().click();
  for(let i=0;i<100;i++) {try{await fs.access(path.join(directory,'passed.json'));break;}catch{await new Promise(r=>setTimeout(r,100));}}
  await fs.access(path.join(directory,'passed.json'));
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results/vscode-notebook.png')});
  await fs.writeFile(path.join(directory,'browser-done'),'done');
  await browser.close();browser=undefined;
  await host;
  console.log('PASS: real VS Code renderer toolbar → annotation → sidebar note → notebook save.');
} catch(error) {
  console.error('Integration artifacts:',directory);
  if(browser){const p=browser.contexts()[0]?.pages()[0];await p?.screenshot({path:path.join(root,'test-results/vscode-failure.png')}).catch(()=>{});await browser.close();}
  throw error;
}
