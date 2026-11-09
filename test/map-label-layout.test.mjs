import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { layoutMapLabels } from '../scripts/map-label-layout.mjs';

test('实际字体下重叠标签外移，保留节点和引导线起点，静态HTML回读仍无碰撞',async()=>{
  const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app')?{channel:'chrome'}:{})});
  try {
    const page=await browser.newPage();
    await page.setContent(`<style>.jp-label{font:16px sans-serif;stroke:#fff;stroke-width:4px;paint-order:stroke}</style>
      <div class="japan-map-plate"><svg viewBox="0 0 500 300" width="500" height="300">
      <circle class="jp-place" cx="210" cy="145" r="3"><title>城市甲节点</title></circle>
      <circle class="jp-place" cx="215" cy="147" r="3"><title>城市乙节点</title></circle>
      <path class="jp-leader" d="M210,145L230,166"/><text class="jp-label" x="230" y="166">城市甲</text>
      <path class="jp-leader" d="M215,147L236,167"/><text class="jp-label" x="236" y="167">城市乙</text>
      <circle class="jp-edge-dot" cx="75" cy="90" r="3"/>
      <path class="jp-leader" d="M75,90L100,90"/><text class="jp-label jp-edge-label" x="100" y="95" text-anchor="end">边缘城</text>
      </svg></div>`);
    await page.evaluate(()=>document.fonts.ready);
    const before=await page.evaluate(layoutMapLabels,{repair:false});
    assert.ok(before.collisions.some(pair=>pair.includes('城市甲')&&pair.includes('城市乙')));
    const result=await page.evaluate(layoutMapLabels);
    assert.deepEqual(result.collisions,[]);assert.deepEqual(result.clipped,[]);
    assert.ok(result.moved.some(p=>p.name==='城市甲'||p.name==='城市乙'));
    const anchor=await page.evaluate(()=>{
      const e=[...document.querySelectorAll('text')].find(e=>e.textContent==='城市甲');
      const point=e.previousElementSibling.getPointAtLength(0);
      return [point.x,point.y];
    });
    assert.deepEqual(anchor,[210,145]);
    const edge=await page.evaluate(()=>{
      const e=document.querySelector('.jp-edge-label');
      return {y:e.getAttribute('y'),dotX:document.querySelector('.jp-edge-dot').getAttribute('cx')};
    });
    assert.deepEqual(edge,{y:'95.00',dotX:'75'});
    const html=await page.content();await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
    const reloaded=await page.evaluate(layoutMapLabels,{repair:false});
    assert.deepEqual(reloaded.collisions,[]);assert.deepEqual(reloaded.clipped,[]);
    assert.equal(await page.locator('text.jp-label').count(),3);
    assert.deepEqual((await page.evaluate(layoutMapLabels)).moved,[]);
    await page.setContent(`<style>.jp-label{font:16px sans-serif}</style>
      <div class="japan-map-plate"><svg viewBox="0 0 500 300" width="500" height="300">
      <path data-edge="true" d="M250,130Q150,65 40,80"/>
      <circle class="jp-edge-dot" cx="40" cy="80" r="3"/>
      <path class="jp-leader" d="M40,80L24,80"/>
      <text class="jp-label jp-edge-label" x="24" y="85" text-anchor="end">Overseas Capital Example</text>
      </svg></div>`);
    await page.evaluate(()=>document.fonts.ready);
    const longName=await page.evaluate(layoutMapLabels);
    assert.deepEqual(longName.collisions,[]);assert.deepEqual(longName.clipped,[]);
    assert.equal(longName.moved[0].kind,'edge-rail');
    const endpoints=await page.evaluate(()=>{
      const dot=document.querySelector('.jp-edge-dot'),path=document.querySelector('[data-edge]');
      const end=path.getPointAtLength(path.getTotalLength());
      return {delta:Math.hypot(end.x-Number(dot.getAttribute('cx')),end.y-Number(dot.getAttribute('cy'))),y:dot.getAttribute('cy')};
    });
    assert.ok(endpoints.delta<.05);assert.equal(endpoints.y,'80');
    // If there is genuinely no room, retain the label and report the conflict
    // so the caller can stop the export instead of hiding a required caption.
    await page.setContent(`<div class="japan-map-plate"><svg width="30" height="20" viewBox="0 0 30 20">
      <text class="jp-label" x="2" y="15">无法放入的完整城市名称</text></svg></div>`);
    const noRoom=await page.evaluate(layoutMapLabels);
    assert.equal(noRoom.clipped.length,1);assert.equal(await page.locator('text').count(),1);
  } finally { await browser.close(); }
});
