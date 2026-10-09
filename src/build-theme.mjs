// Writes theme.json at the repo root from theme.mjs.
//
// The theme starts from the tokens of OpenStation's Legacy manifest
// (legacy-theme.json), so every literal the shell exposes is answered
// with a light, pre-brand value, and then overrides what the era
// looked like. A token set to null in theme.mjs is dropped. Run after
// editing theme.mjs or icon-map.mjs.
//
// Usage: node src/build-theme.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import theme from './theme.mjs';

const HERE = dirname( fileURLToPath( import.meta.url ) );
const ROOT = join( HERE, '..' );
const legacy = JSON.parse( readFileSync( join( HERE, 'legacy-theme.json' ), 'utf8' ) );

const tokens = { ...legacy.tokens, ...theme.tokens };
for ( const [ k, v ] of Object.entries( tokens ) ) {
	if ( v === null ) {
		delete tokens[ k ];
	}
}
const sorted = Object.fromEntries( Object.entries( tokens ).sort( ( a, b ) => a[ 0 ].localeCompare( b[ 0 ] ) ) );
const manifest = { ...theme.manifest, tokens: sorted };
for ( const key of [ 'fonts', 'iconColor', 'icons', 'textures', 'wallpapers', 'recommendedOsSettings' ] ) {
	if ( theme[ key ] !== undefined ) {
		manifest[ key ] = theme[ key ];
	}
}
writeFileSync( join( ROOT, 'theme.json' ), JSON.stringify( manifest, null, '\t' ) + '\n' );
console.log( `wrote theme.json (${ Object.keys( sorted ).length } tokens)` );
