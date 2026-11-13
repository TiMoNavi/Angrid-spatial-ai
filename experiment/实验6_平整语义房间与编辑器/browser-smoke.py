#!/usr/bin/env python3
"""Real pointer/keyboard regression. Run via uv --with playwright; needs local HTTP.

Screenshots and private-scan results stay under experiment/.private/experiment6-qa.
Set VOXEL_CHROMIUM to override the bundled browser, VOXEL_EDITOR_URL for the page.
"""
import argparse
import json
import math
import os
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / '.private' / 'experiment6-qa'
URL = os.environ.get('VOXEL_EDITOR_URL', 'http://127.0.0.1:5189/' + quote(HERE.name) + '/')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--private-scans', action='store_true')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    errors, results = [], []
    with sync_playwright() as p:
        executable = os.environ.get('VOXEL_CHROMIUM')
        candidates = sorted((Path.home() / 'Library/Caches/ms-playwright').glob('chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell'))
        if not executable and candidates:
            executable = str(candidates[-1])
        browser = p.chromium.launch(executable_path=executable, headless=True, args=['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'])
        page = browser.new_page(viewport={'width': 1440, 'height': 960}, device_scale_factor=1)
        page.on('pageerror', lambda e: errors.append(str(e)[:400]))
        page.on('console', lambda m: errors.append(m.text[:400]) if m.type == 'error' else None)

        def state():
            return page.evaluate('window.__voxelEditor.state')

        def point(v):
            return page.evaluate('(v)=>window.__voxelEditor.worldToScreen(v)', v)

        def planpoint(x, z):
            return page.evaluate('([x,z])=>{const p=new DOMPoint(x,-z).matrixTransform(document.querySelector("#plan-svg").getScreenCTM());return {x:p.x,y:p.y}}', [x,z])

        def load(room):
            page.goto(URL + '?room=' + room + '&debug=1')
            page.wait_for_function('window.__voxelEditor?.state && document.querySelector("#loader").hidden')

        load('sample')
        page.evaluate('Object.keys(localStorage).filter(k=>k.startsWith("angrid-experiment6-scene-v1:")).forEach(k=>localStorage.removeItem(k))')
        load('sample')
        assert len(state()['objects']) == 3
        for view in ('top', 'front', 'side', 'home'):
            page.locator(f'[data-camera="{view}"]').click()
        page.locator('[data-tool="create"]').click()
        a, b = point([0,0,.4]), point([.6,0,.8])
        page.mouse.move(**a)
        page.mouse.down()
        page.mouse.move(**b, steps=12)
        page.mouse.up()
        draft = page.evaluate('window.__voxelEditor.draft')
        assert draft['counts'][:2] == [3,2], draft
        page.mouse.move(b['x'], b['y']-12)
        page.mouse.click(b['x'], b['y']-12)
        assert page.evaluate('window.__voxelEditor.draft.counts[2]') == 2
        page.locator('#draft-name').fill('测试方块')
        page.locator('#confirm-create').click()
        assert len(state()['objects']) == 4
        created = state()['objects'][-1]
        assert all(abs(a-b)<1e-7 for a,b in zip(created['size'], [.6,.4,.4])), created
        assert created['name'] == '测试方块'
        assert created['anchorId'] == 'floor'
        before_density = state()['objects']
        for step in ('0.1','0.05','0.025','0.2'):
            page.select_option('#grid-step', step)
            assert state()['objects'] == before_density
        page.locator('#center-x').fill('0.8')
        page.locator('#rotation-y').fill('90')
        page.locator('#apply-properties').click()
        assert abs(state()['objects'][-1]['center'][0]-.8)<1e-7
        page.locator('#undo').click()
        assert state()['objects'][-1]['center'] == created['center']
        page.locator('#redo').click()
        assert abs(state()['objects'][-1]['rotY']-1.57079632679)<1e-6
        page.locator('#duplicate-object').click()
        assert len(state()['objects']) == 5
        page.locator('#object-locked').check()
        page.locator('#apply-properties').click()
        locked = state()['objects'][-1]
        assert locked['locked'], locked
        page.locator('#clear-furniture').click()
        page.locator('#clear-dialog button[value="clear"]').click()
        page.wait_for_function('!document.querySelector("#clear-dialog").open && window.__voxelEditor.state.objects.length===1')
        assert [o['id'] for o in state()['objects']] == [locked['id']]
        page.locator('#undo').click()
        assert len(state()['objects']) == 5
        before_cancel=state()
        page.locator('#clear-furniture').click()
        page.keyboard.press('Escape')
        page.wait_for_function('!document.querySelector("#clear-dialog").open')
        assert state()==before_cancel, 'Escape must cancel a reopened clear dialog'
        # 2D creation edits the exact same 3D state.
        page.locator('[data-viewmode="plan"]').click()
        page.locator('[data-tool="create"]').click()
        a,b=planpoint(.6,-.8),planpoint(1.2,-.4)
        page.mouse.move(**a);page.mouse.down();page.mouse.move(**b,steps=10);page.mouse.up()
        page.locator('#draft-c').fill('3')
        page.locator('#draft-name').fill('平面创建')
        page.locator('#confirm-create').click()
        assert state()['objects'][-1]['name']=='平面创建'
        assert abs(state()['objects'][-1]['size'][1]-.6)<1e-7
        page.locator('[data-viewmode="scene"]').click()
        page.locator('[data-tool="create"]').click()
        page.mouse.move(**point([.2,0,1.2]));page.mouse.down();page.mouse.move(**point([.6,0,1.6]),steps=5);page.mouse.up()
        count=len(state()['objects']);page.keyboard.press('Escape')
        assert page.evaluate('window.__voxelEditor.draft') is None
        assert len(state()['objects'])==count
        # Export/import, foreign-session rejection, and local persistence.
        with page.expect_download() as download:
            page.locator('#export-scene').click()
        exported=download.value
        saved=json.loads(Path(exported.path()).read_text())
        assert saved==state()
        bad={**saved,'sourceId':'wrong-session'}
        page.locator('#import-file').set_input_files({'name':'foreign.json','mimeType':'application/json','buffer':json.dumps(bad).encode()})
        page.wait_for_function('document.querySelector("#viewer-status").textContent.includes("导入未应用")')
        assert state()==saved
        page.locator('#import-file').set_input_files({'name':'scene.json','mimeType':'application/json','buffer':json.dumps(saved).encode()})
        page.wait_for_function('document.querySelector("#viewer-status").textContent.includes("已导入")')
        expected=state()['objects']
        page.reload();page.wait_for_function('window.__voxelEditor?.state && document.querySelector("#loader").hidden')
        assert state()['objects']==expected
        page.screenshot(path=str(OUT/'sample-editor.png'))
        page.locator('[data-viewmode="plan"]').click()
        page.screenshot(path=str(OUT/'sample-plan.png'))
        results.append('sample: pointer rectangle/extrude, density invariants, properties, undo/redo, duplicate, locks, clear, Layout creation, cancel, save/export/import')
        # Table and wall planes use their own local coordinates and normals.
        page.locator('[data-camera="home"]').click()
        page.select_option('#grid-step','0.2')
        page.select_option('#anchor-select','top-roomplan-0')
        page.locator('[data-tool="create"]').click()
        a,b=point([-1.95,.8,-1.15]),point([-1.35,.8,-.75])
        page.mouse.move(**a);page.mouse.down();page.mouse.move(**b,steps=12);page.mouse.up()
        assert page.evaluate('window.__voxelEditor.draft.counts.slice(0,2)')==[3,2]
        page.locator('#draft-c').fill('2');page.locator('#draft-name').fill('桌面底座')
        page.locator('#confirm-create').click()
        base=state()['objects'][-1]
        assert base['anchorId']=='top-roomplan-0'
        assert all(abs(a-b)<1e-7 for a,b in zip(base['size'],[.6,.4,.4]))
        assert abs(base['center'][1]-1)<1e-7
        page.locator('[data-object-id="roomplan-0"]').first.click()
        table=next(o for o in state()['objects'] if o['id']=='roomplan-0')
        page.locator('#center-x').fill(str(table['center'][0]+.4));page.locator('#apply-properties').click()
        child=next(o for o in state()['objects'] if o['id']==base['id'])
        assert abs(child['center'][0]-base['center'][0]-.4)<1e-7
        page.locator('#undo').click()
        assert next(o for o in state()['objects'] if o['id']==base['id'])==base
        page.select_option('#anchor-select','wall-0')
        page.locator('[data-tool="create"]').click()
        a,b=point([-2.5,.2,-1.8]),point([-2.5,.6,-1.2])
        page.mouse.move(**a);page.mouse.down();page.mouse.move(**b,steps=12);page.mouse.up()
        page.locator('#draft-c').fill('2');page.locator('#draft-name').fill('墙面方块')
        assert page.locator('#confirm-create').is_enabled()
        page.locator('#confirm-create').click()
        wall_box=state()['objects'][-1]
        assert wall_box['anchorId']=='wall-0'
        assert abs(wall_box['center'][0]+2.3)<1e-7
        page.locator('[data-tool="create"]').click()
        a,b=point([-2.5,1,-.8]),point([-2.5,1.4,-.2])
        page.mouse.move(**a);page.mouse.down();page.mouse.move(**b,steps=12);page.mouse.up()
        assert page.locator('#confirm-create').is_disabled()
        assert '门窗' in page.locator('#draft-warning').inner_text()
        before=state();page.keyboard.press('Escape');assert state()==before
        # An oblique, non-square footprint must use Three.js's rotation sign.
        page.locator('[data-object-id="roomplan-0"]').first.click()
        page.locator('#rotation-y').fill('30');page.locator('#apply-properties').click()
        page.locator('[data-viewmode="plan"]').click()
        page.locator('[data-tool="select"]').click()
        actual=page.locator('#plan-svg [data-object-id="roomplan-0"]').evaluate('(g)=>{const t=g.transform.baseVal.getItem(1).matrix;return [t.a,t.b]}')
        assert abs(actual[0]-.8660254)<1e-6 and abs(actual[1]-.5)<1e-6,actual
        with page.expect_download() as download:
            page.locator('#export-plan').click()
        assert '<svg' in Path(download.value.path()).read_text()
        before=state();initial_box=page.locator('#plan-svg').get_attribute('viewBox')
        a=planpoint(0,-1.5);page.mouse.move(**a);page.mouse.wheel(0,-300)
        page.wait_for_function('(box)=>document.querySelector("#plan-svg").getAttribute("viewBox")!==box',arg=initial_box)
        zoomed_box=page.locator('#plan-svg').get_attribute('viewBox')
        assert zoomed_box!=initial_box
        page.mouse.down();page.mouse.move(a['x']+50,a['y']+30,steps=8);page.mouse.up()
        assert page.locator('#plan-svg').get_attribute('viewBox')!=zoomed_box
        assert state()==before,'Layout navigation must not edit scene geometry'
        page.locator('#fit-plan').click()
        assert page.locator('#plan-svg').get_attribute('viewBox')==initial_box
        page.locator('#plan-svg [data-object-id="roomplan-1"]').click()
        assert page.locator('#object-name').input_value()=='柜子 1'
        page.mouse.move(**planpoint(0,-1.5));page.mouse.wheel(0,200)
        page.wait_for_function('(box)=>document.querySelector("#plan-svg").getAttribute("viewBox")!==box',arg=initial_box)
        page.mouse.dblclick(**planpoint(0,-1.5))
        assert page.locator('#plan-svg').get_attribute('viewBox')==initial_box
        page.screenshot(path=str(OUT/'sample-anchors-plan.png'))
        results.append('sample anchors: tabletop 3×2×2, support carries child, wall normal extrusion, opening rejection, 30-degree Layout projection, SVG export, Layout pan/zoom/fit/selection')
        # Exercise the real TransformControls picker with pointer drags.
        page.locator('[data-camera="home"]').click()
        page.locator(f'[data-object-id="{created["id"]}"]').first.click()
        page.locator('#rotation-y').fill('0');page.locator('#apply-properties').click()

        def current_created():
            return next(o for o in state()['objects'] if o['id']==created['id'])

        def find_x_handle(item):
            c=item['center']
            for offset in [.3,.4,.5,.6,.7,.8,.9,1,1.2]:
                q=point([c[0]+offset,c[1],c[2]])
                page.mouse.move(**q)
                if page.evaluate('window.__voxelEditor.transform.axis')=='X':
                    return q
            raise AssertionError('Could not hover the actual X transform handle')

        page.locator('[data-tool="translate"]').click()
        before=current_created();q=find_x_handle(before)
        origin=point(before['center']);end=point([before['center'][0]+.6,*before['center'][1:]])
        page.mouse.down();page.mouse.move(q['x']+end['x']-origin['x'],q['y']+end['y']-origin['y'],steps=12);page.mouse.up()
        after=current_created()
        assert abs(after['center'][0]-before['center'][0])>.1,(before,after)
        assert after['size']==before['size']
        page.locator('#undo').click();assert current_created()==before
        page.locator('[data-tool="scale"]').click()
        q=find_x_handle(before)
        page.mouse.down();page.mouse.move(q['x']+45,q['y']-12,steps=12);page.mouse.up()
        after=current_created()
        assert after['size'][0]!=before['size'][0],(before,after)
        assert after['center']==before['center']
        page.locator('#undo').click();assert current_created()==before
        page.locator('[data-tool="rotate"]').click()
        found=None;c=before['center']
        for radius in [.3,.4,.5,.6,.7,.8,.9,1,1.2]:
            for angle in [0,.4,.8,1.2,1.6,2,2.4,2.8,3.2,3.6,4,4.4,4.8,5.2,5.6,6]:
                q=point([c[0]+radius*math.cos(angle),c[1],c[2]+radius*math.sin(angle)])
                page.mouse.move(**q)
                if page.evaluate('window.__voxelEditor.transform.axis')=='Y':
                    found=(q,radius,angle);break
            if found:break
        assert found,'Could not hover the actual Y rotation ring'
        q,radius,angle=found
        end=point([c[0]+radius*math.cos(angle+.6),c[1],c[2]+radius*math.sin(angle+.6)])
        page.mouse.down();page.mouse.move(**end,steps=20);page.mouse.up()
        after=current_created()
        assert abs(after['rotY']-before['rotY'])>.1,(before,after)
        assert after['size']==before['size']
        page.screenshot(path=str(OUT/'sample-transform.png'))
        results.append('real TransformControls: pointer-picked X translation, X scale, Y rotation, undo')
        if args.private_scans:
            for room,count in [('office-1',6),('office-2',5)]:
                load(room)
                assert len(state()['objects'])==count
                original=state()['objects']
                for step in ('0.2','0.1','0.05','0.025'):
                    page.select_option('#grid-step',step)
                    assert state()['objects']==original
                page.select_option('#grid-step','0.2')
                page.locator('[data-camera="home"]').click()
                page.screenshot(path=str(OUT/(room+'-editor.png')))
                page.locator('[data-viewmode="plan"]').click()
                page.screenshot(path=str(OUT/(room+'-plan.png')))
                page.locator('[data-viewmode="scene"]').click()
                if room=='office-2':
                    page.locator('[data-source="overlay"]').click()
                    page.wait_for_function('document.querySelector("#viewer-status").textContent.includes("扫描已叠加")',timeout=60000)
                    page.screenshot(path=str(OUT/(room+'-overlay.png')))
                    page.locator('[data-source="model"]').click()
                results.append(room+': real RoomPlan load, density invariants, 3D/Layout')
        page.set_viewport_size({'width':390,'height':844})
        page.locator('#controls-toggle').click()
        assert page.locator('#sidebar').is_visible()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(OUT/'mobile-controls.png'))
        assert not errors, errors
        browser.close()
    report={'passed':results,'errors':errors,'output':'private local QA directory'}
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
