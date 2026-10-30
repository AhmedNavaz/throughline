import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {createKeepAwake} from '../desktop/keep-awake.mjs';

function fixture(t,options={}) {
  const registry=new EventEmitter();registry.brokers=new Map();
  const active=new Set(),starts=[],stops=[],saved=[],changes=[];
  const blocker={start(type){starts.push(type);const id=starts.length;active.add(id);return id;},stop(id){stops.push(id);return active.delete(id);},isStarted:id=>active.has(id)};
  const controller=createKeepAwake({registry,blocker,pollMs:0,save:value=>saved.push(value),onChange:state=>changes.push(state),...options});
  t.after(()=>controller.dispose());
  return {registry,active,starts,stops,saved,changes,blocker,controller};
}
const tick=()=>new Promise(resolve=>queueMicrotask(resolve));

test('auto keep awake follows all workspaces, including submission events before running is assigned',async t=>{
  const f=fixture(t);assert.equal(f.controller.getState().enabled,false);
  f.controller.setEnabled(true);assert.deepEqual(f.saved,[true]);assert.equal(f.starts.length,0,'Idle display sleep is allowed.');
  const first={broker:{running:null}},second={broker:{running:null}};f.registry.brokers.set('one',first);f.registry.brokers.set('two',second);
  f.registry.emit('update');first.broker.running={};await tick();
  assert.deepEqual(f.starts,['prevent-display-sleep']);assert.equal(f.controller.getState().active,true);
  second.broker.running={};f.registry.emit('update');await tick();assert.equal(f.controller.getState().runningCount,2);assert.equal(f.starts.length,1);
  first.broker.running=null;f.registry.emit('update');await tick();assert.equal(f.controller.getState().active,true);assert.equal(f.stops.length,0);
  second.broker.running=null;f.registry.emit('update');await tick();assert.equal(f.controller.getState().active,false);assert.equal(f.stops.length,1);
});

test('disabled means no blocker during runs; enabling mid-run and disabling release it immediately',t=>{
  const f=fixture(t);f.registry.brokers.set('one',{broker:{running:{}}});assert.equal(f.controller.getState().active,false);assert.equal(f.starts.length,0);
  assert.equal(f.controller.setEnabled(true).active,true);assert.equal(f.controller.setEnabled(false).active,false);
  assert.deepEqual(f.saved,[true,false]);assert.equal(f.active.size,0);
});

test('quitting releases the native blocker and queued updates cannot rearm it',async t=>{
  const f=fixture(t,{enabled:true});f.registry.brokers.set('one',{broker:{running:{}}});f.controller.getState();
  f.registry.emit('update');f.controller.dispose();await tick();
  assert.equal(f.active.size,0);assert.equal(f.registry.listenerCount('update'),0);assert.equal(f.registry.listenerCount('projects'),0);
  assert.equal(f.starts.length,1);assert.throws(()=>f.controller.setEnabled(true),/stopping/);
});

test('failed preference saves do not silently enable wake prevention; invalid IPC values are rejected',t=>{
  const f=fixture(t,{save:()=>{throw Error('Read-only settings');}});f.registry.brokers.set('one',{broker:{running:{}}});
  assert.throws(()=>f.controller.setEnabled(true),/Read-only/);assert.equal(f.controller.getState().enabled,false);assert.equal(f.active.size,0);
  for(const value of ['true',null,{},1])assert.throws(()=>f.controller.setEnabled(value),/enabled or disabled/);
});

test('native failures are reported and a later update can recover',async t=>{
  const f=fixture(t,{enabled:true});let failed=true;
  const start=f.blocker.start;f.blocker.start=type=>{if(failed)throw Error('Native blocker unavailable');return start(type);};
  f.registry.brokers.set('one',{broker:{running:{}}});assert.match(f.controller.getState().error,/unavailable/);assert.equal(f.active.size,0);
  failed=false;f.registry.emit('update');await tick();assert.equal(f.controller.getState().error,null);assert.equal(f.controller.getState().active,true);
});
