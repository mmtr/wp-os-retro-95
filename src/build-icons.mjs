#!/usr/bin/env node
/*
 * Builds the theme's iconset from the ASCII pixel art in `icons.txt`.
 *
 *   node src/build-icons.mjs
 *
 * Every icon in `icons.txt` is written to `icons/<name>.svg` at the repo
 * root. The format (see the top of the file):
 *
 *   color K #000000          one character per colour; `.` is transparent
 *   icon dock-posts 20x20    canvas size; the grid below is centred on it,
 *   icon dock-mio 20x20 @2,1 or placed at an explicit x,y offset
 *   ....KKKK....             one row per line, until a blank line
 *
 * The SVGs hold nothing but `<rect>`s, so the theme sanitizer has nothing
 * to strip. Also writes `icon-sheet.html` beside this script, the contact
 * sheet.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname( fileURLToPath( import.meta.url ) );

function parseSet( file ) {
	const lines = readFileSync( file, 'utf8' ).split( /\r?\n/ );
	const palette = new Map();
	const icons = [];
	let current = null;

	const fail = ( n, msg ) => {
		throw new Error( `${ basename( file ) }:${ n + 1 }: ${ msg }` );
	};
	const finish = () => {
		if ( ! current ) {
			return;
		}
		const { name, rows, line } = current;
		if ( ! rows.length ) {
			fail( line, `icon "${ name }" has no rows` );
		}
		const width = rows[ 0 ].text.length;
		for ( const row of rows ) {
			if ( row.text.length !== width ) {
				fail( row.line, `"${ name }": row is ${ row.text.length } wide, expected ${ width }` );
			}
			for ( const ch of row.text ) {
				if ( ch !== '.' && ! palette.has( ch ) ) {
					fail( row.line, `"${ name }": unknown colour "${ ch }"` );
				}
			}
		}
		const height = rows.length;
		const x = current.x ?? Math.floor( ( current.w - width ) / 2 );
		const y = current.y ?? Math.floor( ( current.h - height ) / 2 );
		if ( x < 0 || y < 0 || x + width > current.w || y + height > current.h ) {
			fail( line, `"${ name }": ${ width }x${ height } grid at ${ x },${ y } does not fit ${ current.w }x${ current.h }` );
		}
		icons.push( { name, w: current.w, h: current.h, x, y, rows: rows.map( ( r ) => r.text ) } );
		current = null;
	};

	lines.forEach( ( raw, n ) => {
		const text = raw.trim();
		if ( text.startsWith( '#' ) ) {
			return;
		}
		if ( ! text ) {
			finish();
			return;
		}
		let m;
		if ( ( m = text.match( /^color\s+(\S)\s+(#[0-9a-fA-F]{6})\b/ ) ) ) {
			if ( m[ 1 ] === '.' ) {
				fail( n, '"." is reserved for transparent' );
			}
			palette.set( m[ 1 ], m[ 2 ].toLowerCase() );
			return;
		}
		if ( ( m = text.match( /^icon\s+([a-z0-9-]+)\s+(\d+)x(\d+)(?:\s+@(\d+),(\d+))?$/ ) ) ) {
			finish();
			if ( icons.some( ( i ) => i.name === m[ 1 ] ) ) {
				fail( n, `duplicate icon "${ m[ 1 ] }"` );
			}
			current = {
				name: m[ 1 ],
				w: Number( m[ 2 ] ),
				h: Number( m[ 3 ] ),
				x: m[ 4 ] === undefined ? undefined : Number( m[ 4 ] ),
				y: m[ 5 ] === undefined ? undefined : Number( m[ 5 ] ),
				rows: [],
				line: n,
			};
			return;
		}
		if ( current ) {
			current.rows.push( { text, line: n } );
			return;
		}
		fail( n, `unexpected line "${ text }"` );
	} );
	finish();
	return { palette, icons };
}

/*
 * One rect per horizontal run of a colour, then runs with the same x,
 * width and colour on consecutive rows are stacked into one taller rect.
 */
function toSvg( icon, palette ) {
	const open = new Map();
	const rects = [];
	for ( let r = 0; r < icon.rows.length; r++ ) {
		const row = icon.rows[ r ];
		const runs = [];
		for ( let c = 0; c < row.length; ) {
			const ch = row[ c ];
			let end = c + 1;
			while ( end < row.length && row[ end ] === ch ) {
				end++;
			}
			if ( ch !== '.' ) {
				runs.push( `${ c }:${ end - c }:${ ch }` );
			}
			c = end;
		}
		const seen = new Set( runs );
		for ( const [ key, rect ] of open ) {
			if ( ! seen.has( key ) ) {
				rects.push( rect );
				open.delete( key );
			}
		}
		for ( const key of runs ) {
			if ( open.has( key ) ) {
				open.get( key ).h++;
				continue;
			}
			const [ c, w, ch ] = key.split( ':' );
			open.set( key, { x: Number( c ), y: r, w: Number( w ), h: 1, ch } );
		}
	}
	rects.push( ...open.values() );
	rects.sort( ( a, b ) => a.y - b.y || a.x - b.x );

	const body = rects
		.map(
			( { x, y, w, h, ch } ) =>
				`<rect x="${ x + icon.x }" y="${ y + icon.y }" width="${ w }" height="${ h }" fill="${ palette.get( ch ) }"/>`
		)
		.join( '' );
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ icon.w }" height="${ icon.h }" ` +
		`viewBox="0 0 ${ icon.w } ${ icon.h }" shape-rendering="crispEdges">${ body }</svg>\n`
	);
}

const { palette, icons } = parseSet( join( here, 'icons.txt' ) );

const out = join( here, '..', 'icons' );
mkdirSync( out, { recursive: true } );
for ( const icon of icons ) {
	writeFileSync( join( out, `${ icon.name }.svg` ), toSvg( icon, palette ) );
}
const defined = new Set( icons.map( ( i ) => `${ i.name }.svg` ) );
const stale = readdirSync( out ).filter( ( f ) => f.endsWith( '.svg' ) && ! defined.has( f ) );
console.log( `${ icons.length } icons -> ${ out }` );
if ( stale.length ) {
	console.warn( `  not in icons.txt (delete by hand if unwanted): ${ stale.join( ', ' ) }` );
}

// The contact sheet: every icon at 1x and 4x on the surfaces it is shown on.
const backgrounds = [
	[ 'desktop #008080', 'background:#008080' ],
	[ 'taskbar #c0c0c0', 'background:#c0c0c0' ],
];
const sections = [];
for ( const [ label, style ] of backgrounds ) {
	for ( const kind of [ 'dock', 'desk' ] ) {
		const group = icons.filter( ( i ) => i.name.startsWith( `${ kind }-` ) );
		if ( ! group.length ) {
			continue;
		}
		const cells = group
			.map(
				( i ) =>
					`<figure><img src="../icons/${ i.name }.svg" width="${ i.w * 4 }" height="${ i.h * 4 }">` +
					`<img src="../icons/${ i.name }.svg" width="${ i.w }" height="${ i.h }">` +
					`<figcaption>${ i.name.replace( `${ kind }-`, '' ) }</figcaption></figure>`
			)
			.join( '' );
		const strip = group
			.map( ( i ) => `<img src="../icons/${ i.name }.svg" width="${ i.w }" height="${ i.h }">` )
			.join( '' );
		sections.push(
			`<section id="${ kind }-${ sections.length }" data-kind="${ kind }">` +
				`<h2>${ kind } &middot; ${ label }</h2>` +
				`<div class="sheet" style='${ style }'>${ cells }<div class="strip">${ strip }</div></div></section>`
		);
	}
}
writeFileSync(
	join( here, 'icon-sheet.html' ),
	`<!doctype html><meta charset="utf-8"><title>Retro 95 icon sheet</title>
<style>
body{margin:0;padding:12px;font:12px/1.2 monospace;background:#555;color:#fff}
h2{font-size:12px;margin:10px 0 4px}
.sheet{display:flex;flex-wrap:wrap;gap:6px;padding:8px}
figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px;min-width:84px}
figcaption{background:#000;color:#fff;padding:1px 4px}
img{image-rendering:pixelated;display:block}
.strip{flex-basis:100%;display:flex;gap:4px;padding:4px}
</style>
<script>
// ?kind=dock narrows the sheet, for screenshots.
addEventListener( 'DOMContentLoaded', () => {
	const kind = new URLSearchParams( location.search ).get( 'kind' );
	for ( const s of document.querySelectorAll( 'section' ) ) {
		s.hidden = Boolean( kind ) && kind !== s.dataset.kind;
	}
} );
</script>
${ sections.join( '\n' ) }
`
);
console.log( `contact sheet -> ${ join( here, 'icon-sheet.html' ) }` );
