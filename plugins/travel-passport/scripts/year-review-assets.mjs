import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ROOT} from './data.mjs';
import {displayGeometry} from './display-geometry.mjs';

let cached;
// Public presentation resources are embedded once in the offline gallery, not
// copied into each year's private data model. Standalone SVGs stay self-contained.
export function loadReviewAssets(){
  cached ||= Promise.all([
    readFile(join(ROOT,'data/geographic-context.json'),'utf8'),
    readFile(join(ROOT,'assets/fonts/manrope/Manrope-Variable.ttf')),
    readFile(join(ROOT,'assets/fonts/dm-serif-display/DMSerifDisplay-Regular.ttf')),
  ]).then(([geography,sans,serif])=>({
    world:displayGeometry(JSON.parse(geography).layers.countries),
    fonts:{sans:sans.toString('base64'),serif:serif.toString('base64')},
  }));
  return cached;
}
