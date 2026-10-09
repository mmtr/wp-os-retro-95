// Builds the theme's chrome/ artwork: the window frame, the title-bar
// and taskbar bevels, the window-control glyphs and the desk tile.
//
// Each piece is a small pixel grid painted from an ordered list of
// rings (outermost first), then written as an SVG of merged rects.
// theme.json 9-slices these through `border-image` or stretches them
// as button faces, so every edge is whole pixels at 1x.
//
// Usage: node src/build-chrome.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join( dirname( fileURLToPath( import.meta.url ) ), '..' );

/**
 * A grid of `w` x `h` pixels filled with `fill` (or transparent), then
 * painted with bevel rings. Each ring is `[ topLeft, bottomRight ]`:
 * ring 0 is the outermost pixel, ring 1 the next one in. The
 * bottom-right colour wins at the two shared corners, as the box
 * shadows in the original UIs did.
 */
function bevel( w, h, rings, fill = null ) {
	const px = Array.from( { length: h }, () => Array( w ).fill( fill ) );
	rings.forEach( ( [ tl, br ], i ) => {
		for ( let y = i; y < h - i; y++ ) {
			for ( let x = i; x < w - i; x++ ) {
				const onTop = y === i;
				const onLeft = x === i;
				const onBottom = y === h - 1 - i;
				const onRight = x === w - 1 - i;
				if ( ! ( onTop || onLeft || onBottom || onRight ) ) {
					continue;
				}
				px[ y ][ x ] = onBottom || onRight ? br : tl;
			}
		}
	} );
	return px;
}

function toSvg( px ) {
	const h = px.length;
	const w = px[ 0 ].length;
	const rects = [];
	for ( let y = 0; y < h; y++ ) {
		let x = 0;
		while ( x < w ) {
			const c = px[ y ][ x ];
			let end = x + 1;
			while ( end < w && px[ y ][ end ] === c ) {
				end++;
			}
			if ( c ) {
				rects.push( { x, y, w: end - x, h: 1, c } );
			}
			x = end;
		}
	}
	// Merge vertically identical runs.
	const merged = [];
	for ( const r of rects ) {
		const above = merged.find( ( m ) => m.x === r.x && m.w === r.w && m.c === r.c && m.y + m.h === r.y );
		if ( above ) {
			above.h++;
		} else {
			merged.push( { ...r } );
		}
	}
	const body = merged
		.map( ( r ) => `<rect x="${ r.x }" y="${ r.y }" width="${ r.w }" height="${ r.h }" fill="${ r.c }"/>` )
		.join( '' );
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${ w }" height="${ h }" viewBox="0 0 ${ w } ${ h }" shape-rendering="crispEdges">${ body }</svg>\n`;
}

function write( name, px ) {
	const file = join( ROOT, 'chrome', `${ name }.svg` );
	mkdirSync( dirname( file ), { recursive: true } );
	writeFileSync( file, toSvg( px ) );
	console.log( 'wrote', file );
}

const W95 = {
	black: '#000000',
	dark: '#808080',
	face: '#c0c0c0',
	light: '#dfdfdf',
	white: '#ffffff',
	navy: '#000080',
};

// Window frame: 2px raised bevel + 1px face, sliced 3 / width 3px.
write( 'frame', bevel( 7, 7, [ [ W95.light, W95.black ], [ W95.white, W95.dark ], [ W95.face, W95.face ] ] ) );
// Raised title-bar control: the bevel only. The face is the button's
// own background colour, so hover and the close button's red show
// through it.
write( 'button', bevel( 16, 14, [ [ W95.white, W95.black ], [ W95.light, W95.dark ] ] ) );
// The same button pressed in.
write( 'button-pressed', bevel( 16, 14, [ [ W95.black, W95.white ], [ W95.dark, W95.light ] ] ) );
// Sunken well (fields, the tray, list boxes): 9-slice, slice 2.
write( 'sunken', bevel( 5, 5, [ [ W95.dark, W95.white ], [ W95.black, W95.light ] ] ) );
// Taskbar: one light line on top of the face, tiled horizontally.
write( 'taskbar', [ [ W95.light ], [ W95.white ], ...Array( 26 ).fill( [ W95.face ] ) ] );

/**
 * A glyph from ASCII art: `#` is ink, anything else is transparent.
 * Control glyphs are painted as masks, so only the shape matters.
 */
function glyph( rows, ink = '#000000' ) {
	return rows.map( ( row ) => [ ...row ].map( ( ch ) => ( ch === '#' ? ink : null ) ) );
}

function writeGlyph( name, rows ) {
	write( `glyph-${ name }`, glyph( rows ) );
}

// Glyphs sit in a 14x14 box centred on a 16x14 button, so column 0
// here is the button's column 1. Positions match the era's controls.
writeGlyph( 'minimize', [
	'..............',
	'..............',
	'..............',
	'..............',
	'..............',
	'..............',
	'..............',
	'..............',
	'..............',
	'...######.....',
	'...######.....',
	'..............',
	'..............',
	'..............',
] );
writeGlyph( 'maximize', [
	'..............',
	'..............',
	'..#########...',
	'..#########...',
	'..#.......#...',
	'..#.......#...',
	'..#.......#...',
	'..#.......#...',
	'..#.......#...',
	'..#.......#...',
	'..#########...',
	'..............',
	'..............',
	'..............',
] );
writeGlyph( 'close', [
	'..............',
	'..............',
	'..............',
	'...##....##...',
	'....##..##....',
	'.....####.....',
	'......##......',
	'.....####.....',
	'....##..##....',
	'...##....##...',
	'..............',
	'..............',
	'..............',
	'..............',
] );
writeGlyph( 'fullscreen', [
	'..............',
	'..............',
	'..###...###...',
	'..##.....##...',
	'..#.#...#.#...',
	'.....#.#......',
	'..............',
	'.....#.#......',
	'..#.#...#.#...',
	'..##.....##...',
	'..###...###...',
	'..............',
	'..............',
	'..............',
] );
writeGlyph( 'fullscreen-exit', [
	'..............',
	'..............',
	'..#.......#...',
	'...#.....#....',
	'....##.##.....',
	'....#...#.....',
	'..............',
	'....#...#.....',
	'....##.##.....',
	'...#.....#....',
	'..#.......#...',
	'..............',
	'..............',
	'..............',
] );
writeGlyph( 'menu', [
	'..............',
	'..............',
	'..............',
	'..............',
	'..............',
	'..............',
	'..............',
	'..............',
	'..##..##..##..',
	'..##..##..##..',
	'..............',
	'..............',
	'..............',
	'..............',
] );
writeGlyph( 'reload', [
	'..............',
	'..............',
	'....#####.....',
	'...#.....#.#..',
	'..#.......##..',
	'..#......###..',
	'..#...........',
	'..#.......#...',
	'..#.......#...',
	'...#.....#....',
	'....#####.....',
	'..............',
	'..............',
	'..............',
] );
writeGlyph( 'detach', [
	'..............',
	'..............',
	'.......######.',
	'.........####.',
	'........#####.',
	'..####.###.##.',
	'..#...###...#.',
	'..#..###....#.',
	'..#.........#.',
	'..#.........#.',
	'..#.........#.',
	'..###########.',
	'..............',
	'..............',
] );

// The solid teal desk, tiled.
write( 'desk-teal', [ [ '#008080', '#008080' ], [ '#008080', '#008080' ] ] );

// Taskbar keys: the same bevel at the taskbar's own tile size, so a
// 1px line stays 1px instead of being stretched.
write( 'key', bevel( 24, 24, [ [ W95.white, W95.black ], [ W95.light, W95.dark ] ], W95.face ) );
write( 'key-pressed', bevel( 24, 24, [ [ W95.black, W95.white ], [ W95.dark, W95.light ] ], W95.face ) );
