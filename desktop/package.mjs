import {packager} from '@electron/packager';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const identity=process.env.AI_RELAY_SIGN_IDENTITY;
// The Agent SDK's bundled Claude Code binary is left out: Throughline always runs the user's own installed Claude Code.
const builds=await packager({dir:root,name:'Throughline',out:path.join(root,'dist'),overwrite:true,asar:false,prune:true,appBundleId:'local.throughline.desktop',icon:path.join(root,'assets',process.platform==='win32'?'icon.ico':process.platform==='darwin'?'icon.icns':'icon.png'),appCategoryType:'public.app-category.developer-tools',ignore:[/\.code-workspace$/,/^\/\.data(?:\/|$)/,/^\/docs(?:\/|$)/,/^\/\.github(?:\/|$)/,/^\/dist(?:\/|$)/,/^\/output(?:\/|$)/,/^\/test(?:\/|$)/,/^\/\.git(?:\/|$)/,/^\/sharing\/\.data(?:\/|$)/,/^\/sharing\/test(?:\/|$)/,/^\/install\.sh$/,/^\/node_modules\/@anthropic-ai\/claude-agent-sdk-[^/]+(?:\/|$)/],...(identity?{osxSign:{identity}}:{})});
// Packaging invalidates Electron's signature. Without an identity, sign ad hoc so Apple Silicon will launch the app (it is still not notarized).
if(process.platform==='darwin'&&!identity) for(const build of builds) execFileSync('codesign',['--force','--deep','--sign','-',path.join(build,'Throughline.app')],{stdio:'inherit'});
console.log('Packaged Throughline: '+builds.join(', '));
