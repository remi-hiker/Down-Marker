import { test, expect } from '@playwright/test';
test.beforeEach(async ({page}) => {
  await page.goto('http://127.0.0.1:4179');
  await page.waitForFunction(() => !!(window as any).harness);
});
test('selects rendered text across bold and inline code, persists colour and notes, and removes it', async ({page}) => {
  await page.evaluate(async () => {
    const h = (window as any).harness;
    await h.render('# Study\n\nRead **important** and `code` together.');
    const root = document.querySelector('section')!.shadowRoot!.querySelector('#preview')!;
    const start = root.querySelector('strong')!.firstChild!;
    const end = root.querySelector('code')!.firstChild!;
    const range = document.createRange(); range.setStart(start,0);range.setEnd(end,4);
    const selection = window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
  });
  await expect(page.getByRole('toolbar')).toBeVisible();
  await page.getByRole('button',{name:'Highlight green',exact:true}).click();
  const created = await page.evaluate(() => (window as any).harness.messages.find((m: any) => m.type === 'create'));
  expect(created.anchor.exact).toBe('important and code');
  expect(created.color).toBe('green');
  await page.evaluate(async data => {
    window.getSelection()!.removeAllRanges();
    const h = (window as any).harness;
    await h.render('# Study\n\nRead **important** and `code` together.',[{id:'note1',color:'green',note:'My insight <script>alert(1)</script>',created:'now',rendered:data.anchor}]);
  },created);
  await expect(page.locator('mark')).toHaveCount(3);
  await expect(page.locator('strong mark')).toHaveText('important');
  await expect(page.locator('code mark')).toHaveText('code');
  await page.locator('strong mark').click();
  await page.getByRole('button',{name:'Add or edit a note'}).click();
  expect(await page.evaluate(() => (window as any).harness.messages.some((m: any) => m.type==='edit' && m.ids[0]==='note1'))).toBe(true);
  await page.evaluate(() => (window as any).harness.update([]));
  await expect(page.locator('mark')).toHaveCount(0);
  await expect(page.locator('strong')).toHaveText('important');
});
test('retains fenced-code marks through asynchronous syntax highlighting and handles overlaps', async ({page}) => {
  await page.evaluate(async () => {
    const h = (window as any).harness;
    const rendered = 'value = 42\nprint(value)\n';
    await h.render('```python\n'+rendered+'```',[
      {id:'a',color:'yellow',note:'value',created:'now',rendered:h.anchor(rendered,0,10)},
      {id:'b',color:'pink',note:'answer',created:'now',rendered:h.anchor(rendered,8,10)},
    ]);
    const root = document.querySelector('section')!.shadowRoot!.querySelector('code')!;
    root.innerHTML = '<div class="monaco-tokenized-source"><span class="token">value</span> = 42<br>print(value)<br></div>';
  });
  await expect(page.locator('code mark')).toHaveCount(3);
  await expect(page.locator('mark').filter({hasText:'42'})).toHaveAttribute('data-down-marker','["a","b"]');
  await expect(page.locator('code')).toHaveText('value = 42print(value)');
});
test('re-rendering disposes old toolbars, isolates identical cells, and shows source highlights', async ({page}) => {
  await page.evaluate(async () => {
    const h = (window as any).harness;
    const annotation = {id:'a',color:'blue',note:'',created:'now',source:h.anchor('hello world',6,11)};
    await h.render('hello world',[annotation]);
    await h.render('hello world',[annotation]);
    await h.render('hello world',[], 'cell-2');
  });
  await expect(page.locator('.dm-toolbar')).toHaveCount(2);
  await expect(page.locator('#cell-1 mark')).toHaveText('world');
  await expect(page.locator('#cell-2 mark')).toHaveCount(0);
});

test('preserves multiline fenced-code anchors when VS Code replaces newlines with BR elements', async ({page}) => {
  await page.evaluate(async () => {
    const h = (window as any).harness;
    const text = 'first = 1\nsecond = 2\n';
    await h.render('```python\n'+text+'```', [{id:'multi', color:'yellow', note:'', created:'now', rendered:h.anchor(text,0,text.length-1)}]);
    document.querySelector('section')!.shadowRoot!.querySelector('code')!.innerHTML = '<div><span>first = 1</span><br><span>second = 2</span><br></div>';
  });
  await expect(page.locator('mark')).toHaveCount(2);
  await expect(page.locator('mark').nth(1)).toHaveText('second = 2');
});
