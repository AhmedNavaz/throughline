import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {createAppearance} from '../desktop/appearance.mjs';

// Like Electron's nativeTheme: themeSource overrides the OS appearance, and `updated` fires when the effective one changes.
function nativeTheme(dark) {
  const theme=new EventEmitter();let source='system';
  const effective=()=>source==='system'?dark:source==='dark';
  const change=update=>{const before=effective();update();if(effective()!==before)theme.emit('updated');};
  Object.defineProperties(theme,{themeSource:{get:()=>source,set:value=>change(()=>{source=value;})},shouldUseDarkColors:{get:effective}});
  theme.setSystem=value=>change(()=>{dark=value;});
  return theme;
}

test('a new window starts with the background of the saved appearance',()=>{
  for(const [preference,dark,source,color] of [['system',true,'system','#1f1f1f'],['system',false,'system','#ffffff'],['light',true,'light','#ffffff'],['graphite',false,'dark','#1f1f1f']]){
    const native=nativeTheme(dark),appearance=createAppearance({nativeTheme:native});appearance.set(preference);
    assert.equal(native.themeSource,source);assert.equal(appearance.background(),color,`${preference} with a ${dark?'dark':'light'} OS`);
  }
});

test('the window follows System through OS changes, keeps a manual choice, and adopts the OS again on returning to System',()=>{
  const native=nativeTheme(true),backgrounds=[],appearance=createAppearance({nativeTheme:native,onBackground:color=>backgrounds.push(color)});
  appearance.set('system');native.setSystem(false);assert.equal(backgrounds.at(-1),'#ffffff');native.setSystem(true);assert.equal(backgrounds.at(-1),'#1f1f1f');
  appearance.set('light');assert.equal(backgrounds.at(-1),'#ffffff');
  native.setSystem(false);native.setSystem(true);assert.equal(native.themeSource,'light');assert.equal(backgrounds.at(-1),'#ffffff','A manual choice ignores the OS.');
  appearance.set('system');assert.equal(native.themeSource,'system');assert.equal(backgrounds.at(-1),'#1f1f1f','Returning to System adopts the dark OS at once.');
  appearance.set('graphite');native.setSystem(false);assert.equal(native.themeSource,'dark');assert.equal(backgrounds.at(-1),'#1f1f1f');
  appearance.set('system');assert.equal(backgrounds.at(-1),'#ffffff');
});
