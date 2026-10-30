import {packager} from '@electron/packager';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const builds=await packager({dir:root,name:'Throughline',out:path.join(root,'dist'),overwrite:true,asar:false,prune:true,appBundleId:'local.throughline.desktop',icon:path.join(root,'assets',process.platform==='win32'?'icon.ico':process.platform==='darwin'?'icon.icns':'icon.png'),appCategoryType:'public.app-category.developer-tools',ignore:[/^\/\.data(?:\/|$)/,/^\/docs(?:\/|$)/,/^\/\.github(?:\/|$)/,/^\/dist(?:\/|$)/,/^\/test(?:\/|$)/,/^\/\.git(?:\/|$)/,/^\/sharing\/\.data(?:\/|$)/,/^\/sharing\/test(?:\/|$)/],...(process.env.AI_RELAY_SIGN_IDENTITY?{osxSign:{identity:process.env.AI_RELAY_SIGN_IDENTITY}}:{})});
console.log('Packaged Throughline: '+builds.join(', '));
