import * as vscode from 'vscode';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { readNotes, locate } from '../src/model';
export async function run() {
  const directory = process.env.DOWN_MARKER_TEST_DIR!;
  const uri = vscode.Uri.file(path.join(directory, 'integration.ipynb'));
  const original = {
    nbformat:4,nbformat_minor:5,metadata:{custom:'preserve notebook metadata'},cells:[
      {cell_type:'markdown',id:'reading-cell',metadata:{tags:['reading']},source:['# Notebook reading\n','\n','Read **important** and `code` together.\n','\n','```python\n','answer = 42\n','print(answer)\n','```']},
      {cell_type:'code',id:'python-cell',metadata:{tags:['keep-me']},execution_count:7,source:['value = 42\n','print(value)'],outputs:[{output_type:'stream',name:'stdout',text:['42\n']}]},
      {cell_type:'code',id:'sql-cell',metadata:{vscode:{languageId:'sql'}},execution_count:null,source:['SELECT * FROM readings;'],outputs:[]},
    ]};
  await fs.writeFile(uri.fsPath, JSON.stringify(original));
  await vscode.extensions.getExtension('remi-hiker.down-marker')!.activate();
  const notebook = await vscode.workspace.openNotebookDocument(uri);
  await vscode.window.showNotebookDocument(notebook);
  const cell = notebook.cellAt(1);
  let editor = await vscode.window.showTextDocument(cell.document);
  editor.selection = new vscode.Selection(0,0,0,10);
  await vscode.commands.executeCommand('downMarker.highlight');
  assert.equal(readNotes(cell.metadata)?.annotations[0].source?.exact,'value = 42');
  assert.deepEqual(cell.metadata.metadata.tags,['keep-me']);
  editor = await vscode.window.showTextDocument(notebook.cellAt(2).document);
  editor.selection = new vscode.Selection(0,0,0,6);
  await vscode.commands.executeCommand('downMarker.highlight');
  assert.equal(readNotes(notebook.cellAt(2).metadata)?.annotations[0].source?.exact,'SELECT');
  await notebook.save();
  const beforeEdit = JSON.parse(await fs.readFile(uri.fsPath,'utf8'));
  assert.equal(beforeEdit.cells[1].execution_count,7, 'Highlighting must preserve execution count');
  const edit = new vscode.WorkspaceEdit(); edit.insert(cell.document.uri,new vscode.Position(0,0),'# added above\n');
  await vscode.workspace.applyEdit(edit);
  assert.equal(locate(cell.document.getText(),readNotes(cell.metadata)!.annotations[0].source!)?.start,14);
  await notebook.save();
  const saved = JSON.parse(await fs.readFile(uri.fsPath,'utf8'));
  assert.equal(saved.cells[1].metadata.downMarker.annotations.length,1);
  assert.deepEqual(saved.cells[1].outputs,original.cells[1].outputs);
  // VS Code clears execution_count when source code is edited; annotations alone preserve it.
  assert.equal(saved.metadata.custom,original.metadata.custom);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const reopened = await vscode.workspace.openNotebookDocument(uri);
  assert.equal(readNotes(reopened.cellAt(1).metadata)?.annotations.length,1);
  await vscode.window.showNotebookDocument(reopened, {selections:[new vscode.NotebookRange(0,1)]});
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  await fs.writeFile(path.join(directory,'ready.json'), JSON.stringify({uri:uri.toString()}));
  // The browser half exercises the actual VS Code webview and sidebar, not just a mock renderer.
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const annotation = readNotes(reopened.cellAt(0).metadata)?.annotations.find(a => a.note === 'Remember this insight.\nA second line.');
    if (annotation) {
      assert.equal(annotation.rendered?.exact,'important and code'); assert.equal(annotation.color,'blue');
      await reopened.save();
      const final = JSON.parse(await fs.readFile(uri.fsPath,'utf8'));
      assert.equal(final.cells[0].metadata.downMarker.annotations[0].note,'Remember this insight.\nA second line.');
      assert.deepEqual(final.cells[0].metadata.tags,['reading']);
      await fs.writeFile(path.join(directory,'passed.json'),JSON.stringify({passed:true}));
      console.log('PASS: source highlights in Python/SQL, relocation, save/reopen, preserved outputs and metadata, rendered Markdown + notes.');
      // Let the browser capture its final screenshot before the test host closes.
      for (let i=0;i<100;i++) {try{await fs.access(path.join(directory,'browser-done'));return;}catch{await new Promise(r=>setTimeout(r,100));}}
      return;
    }
    await new Promise(resolve => setTimeout(resolve,200));
  }
  throw new Error('Timed out waiting for rendered Markdown annotation and sidebar note.');
}
