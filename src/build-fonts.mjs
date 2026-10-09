#!/usr/bin/env node
/**
 * Builds OS Retro Sans (Regular and Bold) from the ASCII-art glyph sources
 * beside this file into `fonts/<name>.woff` at the repo root, then checks
 * the TrueType font and re-reads every WOFF it wrote.
 *
 *     node src/build-fonts.mjs [os-retro-sans ...]
 *
 * With names, only those outputs are rebuilt.
 * Dependency-free on purpose (node: built-ins only), so the fonts can be
 * rebuilt anywhere without a font toolchain. The source format is described
 * at the top of each .txt file. The theme ships WOFF only, so the TrueType
 * font is built and verified in memory and never written.
 *
 * Outlines: one rectangle per horizontal run of lit pixels, with identical
 * runs in consecutive rows merged into one taller rectangle. Every edge sits
 * on a whole pixel, so at the designed font-size each bitmap pixel covers
 * exactly one CSS pixel.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const HERE = dirname( fileURLToPath( import.meta.url ) );
const OUT = join( HERE, '..', 'fonts' );

const FONTS = [
	{ source: 'retro-sans.txt', file: 'os-retro-sans' },
	{ source: 'retro-sans-bold.txt', file: 'os-retro-sans-bold' },
];

const COPYRIGHT = 'Copyright 2026 OpenStation contributors';
const LICENSE = 'SIL Open Font License 1.1';
const LICENSE_URL = 'https://openfontlicense.org';
const VENDOR = 'NONE';

// head.created / head.modified, fixed so unchanged sources rebuild byte-identical.
const TIMESTAMP = Date.UTC( 2026, 0, 1 ) / 1000 + 2082844800;

// Latin-1 letters built from a base glyph plus a mark, unless the source draws
// the letter itself. Capitals use the mark's ".cap" variant when there is one.
const COMPOSE = new Map( [
	...[ 'grave', 'acute', 'circumflex', 'tilde', 'diaeresis', 'ring' ].map( ( mark, i ) => [ 0xc0 + i, [ 0x41, mark ] ] ),
	[ 0xc7, [ 0x43, 'cedilla' ] ],
	...[ 'grave', 'acute', 'circumflex', 'diaeresis' ].map( ( mark, i ) => [ 0xc8 + i, [ 0x45, mark ] ] ),
	...[ 'grave', 'acute', 'circumflex', 'diaeresis' ].map( ( mark, i ) => [ 0xcc + i, [ 0x49, mark ] ] ),
	[ 0xd1, [ 0x4e, 'tilde' ] ],
	...[ 'grave', 'acute', 'circumflex', 'tilde', 'diaeresis' ].map( ( mark, i ) => [ 0xd2 + i, [ 0x4f, mark ] ] ),
	...[ 'grave', 'acute', 'circumflex', 'diaeresis' ].map( ( mark, i ) => [ 0xd9 + i, [ 0x55, mark ] ] ),
	[ 0xdd, [ 0x59, 'acute' ] ],
	...[ 'grave', 'acute', 'circumflex', 'tilde', 'diaeresis', 'ring' ].map( ( mark, i ) => [ 0xe0 + i, [ 0x61, mark ] ] ),
	[ 0xe7, [ 0x63, 'cedilla' ] ],
	...[ 'grave', 'acute', 'circumflex', 'diaeresis' ].map( ( mark, i ) => [ 0xe8 + i, [ 0x65, mark ] ] ),
	...[ 'grave', 'acute', 'circumflex', 'diaeresis' ].map( ( mark, i ) => [ 0xec + i, [ 0x131, mark ] ] ),
	[ 0xf1, [ 0x6e, 'tilde' ] ],
	...[ 'grave', 'acute', 'circumflex', 'tilde', 'diaeresis' ].map( ( mark, i ) => [ 0xf2 + i, [ 0x6f, mark ] ] ),
	...[ 'grave', 'acute', 'circumflex', 'diaeresis' ].map( ( mark, i ) => [ 0xf9 + i, [ 0x75, mark ] ] ),
	[ 0xfd, [ 0x79, 'acute' ] ],
	[ 0xff, [ 0x79, 'diaeresis' ] ],
	[ 0x178, [ 0x59, 'diaeresis' ] ],
] );

// Characters that share another glyph's drawing, unless the source draws them.
const ALIASES = new Map( [
	[ 0xa0, 0x20 ], // no-break space
	[ 0xad, 0x2d ], // soft hyphen
	[ 0x2010, 0x2d ], // hyphen
	[ 0x2011, 0x2d ], // non-breaking hyphen
	[ 0x201a, 0x2c ], // single low quote
] );

function fail( where, message ) {
	throw new Error( `${ where }: ${ message }` );
}

/* ------------------------------------------------------------------ */
/* Source parsing                                                      */
/* ------------------------------------------------------------------ */

function parseSource( name ) {
	const lines = readFileSync( join( HERE, name ), 'utf8' ).split( /\r?\n/ );
	const font = { name, meta: {}, glyphs: new Map(), marks: new Map() };
	let block = null;

	const close = () => {
		if ( ! block ) {
			return;
		}
		if ( ! block.sawBaseline ) {
			fail( block.where, 'missing the baseline line (a row of "-")' );
		}
		const target = block.kind === 'mark' ? font.marks : font.glyphs;
		if ( target.has( block.key ) ) {
			fail( block.where, `${ block.kind } ${ block.label } is defined twice` );
		}
		target.set( block.key, toBitmap( block ) );
		block = null;
	};

	lines.forEach( ( raw, index ) => {
		const where = `${ name }:${ index + 1 }`;
		const line = raw.trimEnd();
		if ( line === '' || line.startsWith( ';' ) ) {
			return;
		}
		if ( /^[#.]+$/.test( line ) ) {
			if ( ! block ) {
				fail( where, 'bitmap row outside a glyph' );
			}
			( block.sawBaseline ? block.below : block.above ).push( line );
			return;
		}
		if ( /^-+$/.test( line ) ) {
			if ( ! block || block.sawBaseline ) {
				fail( where, 'unexpected baseline line' );
			}
			block.sawBaseline = true;
			return;
		}
		close();
		const [ key, ...args ] = line.replace( /\s*;.*$/, '' ).split( /\s+/ );
		if ( key === 'glyph' ) {
			const [ id, advance ] = args;
			let code;
			if ( id === '.notdef' ) {
				code = '.notdef';
			} else if ( /^U\+[0-9A-F]{4,6}$/i.test( id ) ) {
				code = parseInt( id.slice( 2 ), 16 );
			} else {
				fail( where, `glyph id must be .notdef or U+XXXX, got "${ id }"` );
			}
			if ( ! /^\d+$/.test( advance ?? '' ) ) {
				fail( where, 'glyph needs an advance width in pixels' );
			}
			block = { kind: 'glyph', key: code, label: id, advance: Number( advance ), above: [], below: [], where };
		} else if ( key === 'mark' ) {
			const [ markName, bias = 'center' ] = args;
			if ( ! [ 'left', 'center', 'right' ].includes( bias ) ) {
				fail( where, `mark bias must be left, center or right, got "${ bias }"` );
			}
			block = { kind: 'mark', key: markName, label: markName, bias, above: [], below: [], where };
		} else {
			font.meta[ key ] = args.join( ' ' );
		}
	} );
	close();
	return font;
}

/** Rows are stored bottom-up by `y`: the row resting on the baseline is y = 0. */
function toBitmap( block ) {
	const rows = [];
	block.above.forEach( ( bits, i ) => rows.push( { y: block.above.length - 1 - i, bits } ) );
	block.below.forEach( ( bits, i ) => rows.push( { y: -1 - i, bits } ) );
	let advance = block.advance;
	if ( block.kind === 'glyph' ) {
		for ( const row of rows ) {
			if ( row.bits.length > advance ) {
				fail( block.where, `row "${ row.bits }" is wider than the advance (${ advance })` );
			}
		}
	} else {
		advance = Math.max( 0, ...rows.map( ( r ) => r.bits.length ) );
	}
	return { advance, rows, bias: block.bias, where: block.where };
}

function inkBox( bitmap ) {
	let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
	for ( const { y, bits } of bitmap.rows ) {
		for ( let x = 0; x < bits.length; x++ ) {
			if ( bits[ x ] === '#' ) {
				x0 = Math.min( x0, x );
				x1 = Math.max( x1, x + 1 );
				y0 = Math.min( y0, y );
				y1 = Math.max( y1, y + 1 );
			}
		}
	}
	return x0 === Infinity ? null : { x0, x1, y0, y1 };
}

/** The classic 1px smear: every lit pixel also lights the one to its right. */
function embolden( bitmap, amount ) {
	const rows = bitmap.rows.map( ( { y, bits } ) => {
		let out = '';
		for ( let x = 0; x < bits.length + amount; x++ ) {
			let lit = false;
			for ( let k = 0; k <= amount; k++ ) {
				lit ||= bits[ x - k ] === '#';
			}
			out += lit ? '#' : '.';
		}
		return { y, bits: out };
	} );
	return { ...bitmap, advance: bitmap.advance + amount, rows };
}

function pixelsOf( bitmap ) {
	const set = new Set();
	for ( const { y, bits } of bitmap.rows ) {
		for ( let x = 0; x < bits.length; x++ ) {
			if ( bits[ x ] === '#' ) {
				set.add( `${ x },${ y }` );
			}
		}
	}
	return set;
}

function fromPixels( set, advance, extra ) {
	const byRow = new Map();
	for ( const key of set ) {
		const [ x, y ] = key.split( ',' ).map( Number );
		if ( ! byRow.has( y ) ) {
			byRow.set( y, [] );
		}
		byRow.get( y ).push( x );
	}
	const rows = [ ...byRow ].map( ( [ y, xs ] ) => {
		const width = Math.max( ...xs ) + 1;
		const bits = Array.from( { length: width }, ( _, x ) => ( xs.includes( x ) ? '#' : '.' ) ).join( '' );
		return { y, bits };
	} );
	return { advance, rows, ...extra };
}

function compose( font ) {
	for ( const [ code, [ baseCode, markName ] ] of COMPOSE ) {
		if ( font.glyphs.has( code ) ) {
			continue;
		}
		const base = font.glyphs.get( baseCode );
		const isCap = baseCode >= 0x41 && baseCode <= 0x5a;
		const mark = ( isCap && font.marks.get( `${ markName }.cap` ) ) || font.marks.get( markName );
		if ( ! base || ! mark ) {
			continue;
		}
		const b = inkBox( base );
		const m = inkBox( mark );
		const slack = b.x1 - b.x0 - ( m.x1 - m.x0 );
		let dx = b.x0 - m.x0 + Math.floor( slack / 2 );
		if ( slack % 2 !== 0 && mark.bias === 'right' ) {
			dx += 1;
		}
		const pixels = pixelsOf( base );
		for ( const key of pixelsOf( mark ) ) {
			const [ x, y ] = key.split( ',' ).map( Number );
			pixels.add( `${ x + dx },${ y }` );
		}
		// A mark wider than its base (ï on a 1px stem) widens the glyph, keeping
		// the base's own side bearings.
		const xs = [ ...pixels ].map( ( k ) => Number( k.split( ',' )[ 0 ] ) );
		const shift = Math.max( 0, -Math.min( ...xs ) );
		const shifted = new Set( [ ...pixels ].map( ( k ) => {
			const [ x, y ] = k.split( ',' ).map( Number );
			return `${ x + shift },${ y }`;
		} ) );
		const right = Math.max( ...xs ) + shift + 1 + ( base.advance - b.x1 );
		const advance = Math.max( base.advance + shift, right );
		font.glyphs.set( code, fromPixels( shifted, advance, { composed: true, where: base.where } ) );
	}
}

function loadFont( source ) {
	const font = parseSource( source );
	if ( font.meta.derive ) {
		const parent = parseSource( font.meta.derive );
		const amount = Number( font.meta.embolden ?? 0 );
		const derived = ( map ) => new Map( [ ...map ].map( ( [ k, g ] ) => [ k, amount ? embolden( g, amount ) : g ] ) );
		const glyphs = derived( parent.glyphs );
		const marks = derived( parent.marks );
		for ( const [ k, g ] of font.glyphs ) {
			glyphs.set( k, g );
		}
		for ( const [ k, g ] of font.marks ) {
			marks.set( k, g );
		}
		font.meta = { ...parent.meta, ...font.meta };
		font.glyphs = glyphs;
		font.marks = marks;
	}
	compose( font );
	for ( const [ code, source ] of ALIASES ) {
		if ( ! font.glyphs.has( code ) && font.glyphs.has( source ) ) {
			font.glyphs.set( code, { ...font.glyphs.get( source ), composed: true } );
		}
	}
	for ( const key of [ 'family', 'style', 'weight', 'size', 'upp', 'ascent', 'descent', 'cap-height', 'x-height', 'version' ] ) {
		if ( font.meta[ key ] === undefined ) {
			fail( source, `missing header "${ key }"` );
		}
	}
	if ( ! font.glyphs.has( '.notdef' ) ) {
		fail( source, 'missing glyph .notdef' );
	}
	return font;
}

/* ------------------------------------------------------------------ */
/* Outlines                                                            */
/* ------------------------------------------------------------------ */

function runsOf( bits ) {
	const runs = [];
	let start = -1;
	for ( let x = 0; x <= bits.length; x++ ) {
		const lit = bits[ x ] === '#';
		if ( lit && start < 0 ) {
			start = x;
		} else if ( ! lit && start >= 0 ) {
			runs.push( [ start, x ] );
			start = -1;
		}
	}
	return runs;
}

/** Rectangles in pixel units: { x0, x1, y0, y1 }, y up, edges exclusive of x1/y1. */
function rectsOf( bitmap ) {
	const rows = [ ...bitmap.rows ].sort( ( a, b ) => b.y - a.y );
	const done = [];
	let open = new Map();
	for ( const row of rows ) {
		const next = new Map();
		for ( const [ x0, x1 ] of runsOf( row.bits ) ) {
			const key = `${ x0 },${ x1 }`;
			const rect = open.get( key );
			if ( rect && rect.y0 === row.y + 1 ) {
				rect.y0 = row.y;
				open.delete( key );
				next.set( key, rect );
			} else {
				next.set( key, { x0, x1, y0: row.y, y1: row.y + 1 } );
			}
		}
		done.push( ...open.values() );
		open = next;
	}
	done.push( ...open.values() );
	return done.sort( ( a, b ) => b.y1 - a.y1 || a.x0 - b.x0 );
}

/* ------------------------------------------------------------------ */
/* Binary helpers                                                      */
/* ------------------------------------------------------------------ */

class Writer {
	constructor() {
		this.parts = [];
	}
	put( size, write ) {
		const buf = Buffer.alloc( size );
		write( buf );
		this.parts.push( buf );
		return this;
	}
	u8( v ) {
		return this.put( 1, ( b ) => b.writeUInt8( v ) );
	}
	u16( v ) {
		return this.put( 2, ( b ) => b.writeUInt16BE( v ) );
	}
	i16( v ) {
		return this.put( 2, ( b ) => b.writeInt16BE( v ) );
	}
	u32( v ) {
		return this.put( 4, ( b ) => b.writeUInt32BE( v >>> 0 ) );
	}
	i64( v ) {
		return this.put( 8, ( b ) => b.writeBigInt64BE( BigInt( v ) ) );
	}
	tag( s ) {
		return this.put( 4, ( b ) => b.write( s.padEnd( 4, ' ' ), 'latin1' ) );
	}
	bytes( buf ) {
		this.parts.push( Buffer.from( buf ) );
		return this;
	}
	done() {
		return Buffer.concat( this.parts );
	}
}

const pad4 = ( n ) => ( n + 3 ) & ~3;

function padded( buf ) {
	return buf.length % 4 ? Buffer.concat( [ buf, Buffer.alloc( pad4( buf.length ) - buf.length ) ] ) : buf;
}

function checksum( buf ) {
	let sum = 0;
	for ( let i = 0; i < buf.length; i += 4 ) {
		const word = ( buf[ i ] << 24 ) | ( ( buf[ i + 1 ] ?? 0 ) << 16 ) | ( ( buf[ i + 2 ] ?? 0 ) << 8 ) | ( buf[ i + 3 ] ?? 0 );
		sum = ( sum + word ) >>> 0;
	}
	return sum;
}

function binarySearchFields( count, unit ) {
	const power = 2 ** Math.floor( Math.log2( count ) );
	return { searchRange: power * unit, entrySelector: Math.log2( power ), rangeShift: count * unit - power * unit };
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

function encodeGlyph( rects ) {
	if ( ! rects.length ) {
		return { data: Buffer.alloc( 0 ), points: 0, contours: 0 };
	}
	const points = [];
	const endPts = [];
	for ( const r of rects ) {
		// Clockwise with y up: up the left edge, across the top, down the right.
		points.push( [ r.x0, r.y0 ], [ r.x0, r.y1 ], [ r.x1, r.y1 ], [ r.x1, r.y0 ] );
		endPts.push( points.length - 1 );
	}
	const xMin = Math.min( ...rects.map( ( r ) => r.x0 ) );
	const yMin = Math.min( ...rects.map( ( r ) => r.y0 ) );
	const xMax = Math.max( ...rects.map( ( r ) => r.x1 ) );
	const yMax = Math.max( ...rects.map( ( r ) => r.y1 ) );

	const flags = [];
	const xs = new Writer();
	const ys = new Writer();
	let px = 0;
	let py = 0;
	for ( const [ x, y ] of points ) {
		let flag = 0x01;
		const dx = x - px;
		const dy = y - py;
		if ( dx === 0 ) {
			flag |= 0x10;
		} else if ( Math.abs( dx ) < 256 ) {
			flag |= 0x02 | ( dx > 0 ? 0x10 : 0 );
			xs.u8( Math.abs( dx ) );
		} else {
			xs.i16( dx );
		}
		if ( dy === 0 ) {
			flag |= 0x20;
		} else if ( Math.abs( dy ) < 256 ) {
			flag |= 0x04 | ( dy > 0 ? 0x20 : 0 );
			ys.u8( Math.abs( dy ) );
		} else {
			ys.i16( dy );
		}
		flags.push( flag );
		px = x;
		py = y;
	}
	const packedFlags = [];
	for ( let i = 0; i < flags.length; ) {
		let run = 1;
		while ( i + run < flags.length && flags[ i + run ] === flags[ i ] && run < 256 ) {
			run++;
		}
		if ( run > 1 ) {
			packedFlags.push( flags[ i ] | 0x08, run - 1 );
		} else {
			packedFlags.push( flags[ i ] );
		}
		i += run;
	}

	const w = new Writer().i16( rects.length ).i16( xMin ).i16( yMin ).i16( xMax ).i16( yMax );
	endPts.forEach( ( e ) => w.u16( e ) );
	w.u16( 0 ).bytes( packedFlags ).bytes( xs.done() ).bytes( ys.done() );
	return { data: padded( w.done() ), points: points.length, contours: rects.length, xMin, yMin, xMax, yMax };
}

function buildCmap( mapping ) {
	const segments = [];
	for ( const [ code, gid ] of mapping ) {
		const last = segments[ segments.length - 1 ];
		if ( last && code === last.end + 1 && gid - code === last.delta ) {
			last.end = code;
		} else {
			segments.push( { start: code, end: code, delta: gid - code } );
		}
	}
	segments.push( { start: 0xffff, end: 0xffff, delta: 1 } );
	const count = segments.length;
	const { searchRange, entrySelector, rangeShift } = binarySearchFields( count, 2 );
	const sub = new Writer().u16( 4 ).u16( 16 + count * 8 ).u16( 0 ).u16( count * 2 ).u16( searchRange ).u16( entrySelector ).u16( rangeShift );
	segments.forEach( ( s ) => sub.u16( s.end ) );
	sub.u16( 0 );
	segments.forEach( ( s ) => sub.u16( s.start ) );
	segments.forEach( ( s ) => sub.u16( ( s.delta + 0x10000 ) & 0xffff ) );
	segments.forEach( () => sub.u16( 0 ) );
	// Unicode BMP (0,3) and Windows Unicode BMP (3,1) share the one subtable.
	return new Writer().u16( 0 ).u16( 2 ).u16( 0 ).u16( 3 ).u32( 20 ).u16( 3 ).u16( 1 ).u32( 20 ).bytes( sub.done() ).done();
}

function buildName( entries ) {
	const records = entries.map( ( [ id, text ] ) => ( { id, data: Buffer.from( text, 'utf16le' ).swap16() } ) );
	const w = new Writer().u16( 0 ).u16( records.length ).u16( 6 + 12 * records.length );
	let offset = 0;
	for ( const r of records ) {
		w.u16( 3 ).u16( 1 ).u16( 0x409 ).u16( r.id ).u16( r.data.length ).u16( offset );
		offset += r.data.length;
	}
	records.forEach( ( r ) => w.bytes( r.data ) );
	return w.done();
}

function unicodeRanges( codes ) {
	const has = ( lo, hi ) => codes.some( ( c ) => c >= lo && c <= hi );
	let r1 = 0;
	let r2 = 0;
	if ( has( 0x20, 0x7e ) ) {
		r1 |= 1 << 0;
	}
	if ( has( 0xa0, 0xff ) ) {
		r1 |= 1 << 1;
	}
	if ( has( 0x100, 0x17f ) ) {
		r1 |= 1 << 2;
	}
	if ( has( 0x2000, 0x206f ) ) {
		r1 |= 1 << 31;
	}
	if ( has( 0x20a0, 0x20cf ) ) {
		r2 |= 1 << 1;
	}
	if ( has( 0x2100, 0x214f ) ) {
		r2 |= 1 << 3;
	}
	if ( has( 0x2190, 0x21ff ) ) {
		r2 |= 1 << 5;
	}
	if ( has( 0x2200, 0x22ff ) ) {
		r2 |= 1 << 6;
	}
	return [ r1 >>> 0, r2 >>> 0 ];
}

function buildFont( font ) {
	const m = font.meta;
	const num = ( key ) => {
		const v = Number( m[ key ] );
		if ( ! Number.isInteger( v ) ) {
			fail( font.name, `header "${ key }" must be an integer` );
		}
		return v;
	};
	const size = num( 'size' );
	const upp = num( 'upp' );
	const ascent = num( 'ascent' );
	const descent = num( 'descent' );
	const weight = num( 'weight' );
	const upem = size * upp;
	const bold = weight >= 600;
	const style = m.style;
	const psName = `${ m.family.replace( /[^A-Za-z0-9]/g, '' ) }-${ style.replace( /\s+/g, '' ) }`;

	const codes = [ ...font.glyphs.keys() ].filter( ( k ) => typeof k === 'number' ).sort( ( a, b ) => a - b );
	const order = [ '.notdef', ...codes ];
	const glyphs = order.map( ( key ) => {
		const bitmap = font.glyphs.get( key );
		const rects = rectsOf( bitmap ).map( ( r ) => ( { x0: r.x0 * upp, x1: r.x1 * upp, y0: r.y0 * upp, y1: r.y1 * upp } ) );
		return { key, advance: bitmap.advance * upp, rects, ...encodeGlyph( rects ) };
	} );
	const inked = glyphs.filter( ( g ) => g.contours );

	const xMin = Math.min( ...inked.map( ( g ) => g.xMin ) );
	const yMin = Math.min( ...inked.map( ( g ) => g.yMin ) );
	const xMax = Math.max( ...inked.map( ( g ) => g.xMax ) );
	const yMax = Math.max( ...inked.map( ( g ) => g.yMax ) );
	const lineAscent = ascent * upp;
	const lineDescent = descent * upp;

	const glyf = Buffer.concat( glyphs.map( ( g ) => g.data ) );
	const loca = new Writer();
	let offset = 0;
	for ( const g of glyphs ) {
		loca.u32( offset );
		offset += g.data.length;
	}
	loca.u32( offset );

	const hmtx = new Writer();
	for ( const g of glyphs ) {
		hmtx.u16( g.advance ).i16( g.contours ? g.xMin : 0 );
	}

	const head = new Writer()
		.u16( 1 ).u16( 0 )
		.u32( Math.round( Number( m.version ) * 65536 ) )
		.u32( 0 ) // checkSumAdjustment, filled in once the whole font exists
		.u32( 0x5f0f3cf5 )
		.u16( 0x0001 ) // baseline at y = 0
		.u16( upem )
		.i64( TIMESTAMP ).i64( TIMESTAMP )
		.i16( xMin ).i16( yMin ).i16( xMax ).i16( yMax )
		.u16( bold ? 1 : 0 )
		.u16( size )
		.i16( 2 )
		.i16( 1 ) // long loca
		.i16( 0 )
		.done();

	const hhea = new Writer()
		.u16( 1 ).u16( 0 )
		.i16( lineAscent ).i16( -lineDescent ).i16( 0 )
		.u16( Math.max( ...glyphs.map( ( g ) => g.advance ) ) )
		.i16( Math.min( ...inked.map( ( g ) => g.xMin ) ) )
		.i16( Math.min( ...inked.map( ( g ) => g.advance - g.xMax ) ) )
		.i16( Math.max( ...inked.map( ( g ) => g.xMax ) ) )
		.i16( 1 ).i16( 0 ).i16( 0 )
		.i16( 0 ).i16( 0 ).i16( 0 ).i16( 0 )
		.i16( 0 )
		.u16( glyphs.length )
		.done();

	const maxp = new Writer()
		.u32( 0x00010000 )
		.u16( glyphs.length )
		.u16( Math.max( ...glyphs.map( ( g ) => g.points ) ) )
		.u16( Math.max( ...glyphs.map( ( g ) => g.contours ) ) )
		.u16( 0 ).u16( 0 ) // composite points / contours
		.u16( 2 ) // maxZones
		.u16( 0 ).u16( 0 ).u16( 0 ).u16( 0 ).u16( 0 ).u16( 0 ).u16( 0 ).u16( 0 )
		.done();

	const advances = glyphs.map( ( g ) => g.advance ).filter( Boolean );
	const [ range1, range2 ] = unicodeRanges( codes );
	const capHeight = num( 'cap-height' ) * upp;
	const xHeight = num( 'x-height' ) * upp;
	const scriptSize = Math.round( upem * 0.6 / upp ) * upp;
	const os2 = new Writer()
		.u16( 4 )
		.i16( Math.round( advances.reduce( ( a, b ) => a + b, 0 ) / advances.length ) )
		.u16( weight )
		.u16( 5 ) // normal width
		.u16( 0 ) // installable embedding
		.i16( scriptSize ).i16( scriptSize ).i16( 0 ).i16( Math.round( descent / 2 ) * upp ) // subscript
		.i16( scriptSize ).i16( scriptSize ).i16( 0 ).i16( Math.round( capHeight / upp / 2 ) * upp ) // superscript
		.i16( upp ) // strikeout: one pixel thick, just above half the x-height
		.i16( ( Math.floor( xHeight / upp / 2 ) + 1 ) * upp )
		.i16( 0x0800 ) // sans serif
		.bytes( Buffer.alloc( 10 ) ) // PANOSE: any
		.u32( range1 ).u32( range2 ).u32( 0 ).u32( 0 )
		.tag( VENDOR )
		.u16( ( bold ? 0x20 : 0x40 ) | 0x80 ) // BOLD or REGULAR, plus USE_TYPO_METRICS
		.u16( Math.min( codes[ 0 ], 0xffff ) )
		.u16( Math.min( codes[ codes.length - 1 ], 0xffff ) )
		.i16( lineAscent ).i16( -lineDescent ).i16( 0 )
		.u16( Math.max( lineAscent, yMax ) )
		.u16( Math.max( lineDescent, -yMin ) )
		.u32( ( 1 << 0 ) | ( 1 << 29 ) ).u32( 0 ) // Latin 1, Mac Roman
		.i16( xHeight ).i16( capHeight )
		.u16( 0 ).u16( 0x20 ).u16( 0 )
		.done();

	const fullName = `${ m.family } ${ style }`;
	const name = buildName( [
		[ 0, COPYRIGHT ],
		[ 1, m.family ],
		[ 2, style ],
		[ 3, `${ Number( m.version ).toFixed( 3 ) };${ VENDOR };${ psName }` ],
		[ 4, fullName ],
		[ 5, `Version ${ Number( m.version ).toFixed( 3 ) }` ],
		[ 6, psName ],
		[ 13, LICENSE ],
		[ 14, LICENSE_URL ],
	] );

	const post = new Writer()
		.u32( 0x00030000 )
		.u32( 0 ) // italic angle
		.i16( -upp ).i16( upp ) // underline: the pixel row just below the baseline
		.u32( 0 )
		.u32( 0 ).u32( 0 ).u32( 0 ).u32( 0 )
		.done();

	const mapping = codes.filter( ( c ) => c <= 0xffff ).map( ( c ) => [ c, order.indexOf( c ) ] );
	const tables = {
		'OS/2': os2,
		cmap: buildCmap( mapping ),
		glyf,
		head,
		hhea,
		hmtx: hmtx.done(),
		loca: loca.done(),
		maxp,
		name,
		post,
	};

	return {
		sfnt: assembleSfnt( tables ),
		info: {
			family: m.family,
			style,
			weight,
			psName,
			size,
			upp,
			upem,
			ascent,
			descent,
			winAscent: Math.max( lineAscent, yMax ) / upp,
			winDescent: Math.max( lineDescent, -yMin ) / upp,
			glyphCount: glyphs.length,
			composed: [ ...font.glyphs.values() ].filter( ( g ) => g.composed ).length,
		},
		expect: { codes, order, glyphs, upem, family: m.family },
	};
}

function assembleSfnt( tables ) {
	const tags = Object.keys( tables ).sort();
	const count = tags.length;
	const { searchRange, entrySelector, rangeShift } = binarySearchFields( count, 16 );
	const header = new Writer().u32( 0x00010000 ).u16( count ).u16( searchRange ).u16( entrySelector ).u16( rangeShift );
	let offset = 12 + 16 * count;
	const bodies = [];
	let headOffset = 0;
	for ( const tag of tags ) {
		const data = tables[ tag ];
		header.tag( tag ).u32( checksum( padded( data ) ) ).u32( offset ).u32( data.length );
		if ( tag === 'head' ) {
			headOffset = offset;
		}
		bodies.push( padded( data ) );
		offset += pad4( data.length );
	}
	const font = Buffer.concat( [ header.done(), ...bodies ] );
	font.writeUInt32BE( ( 0xb1b0afba - checksum( font ) ) >>> 0, headOffset + 8 );
	return font;
}

function buildWoff( sfnt ) {
	const count = sfnt.readUInt16BE( 4 );
	const entries = [];
	for ( let i = 0; i < count; i++ ) {
		const at = 12 + i * 16;
		const tag = sfnt.toString( 'latin1', at, at + 4 );
		const sum = sfnt.readUInt32BE( at + 4 );
		const offset = sfnt.readUInt32BE( at + 8 );
		const length = sfnt.readUInt32BE( at + 12 );
		const data = sfnt.subarray( offset, offset + length );
		const deflated = deflateSync( data, { level: 9 } );
		entries.push( { tag, sum, length, stored: deflated.length < length ? deflated : data } );
	}
	let offset = 44 + 20 * count;
	const dir = new Writer();
	const bodies = [];
	for ( const e of entries ) {
		dir.tag( e.tag ).u32( offset ).u32( e.stored.length ).u32( e.length ).u32( e.sum );
		bodies.push( padded( e.stored ) );
		offset += pad4( e.stored.length );
	}
	const totalSfntSize = 12 + 16 * count + entries.reduce( ( a, e ) => a + pad4( e.length ), 0 );
	const head = sfnt.subarray( sfnt.readUInt32BE( 12 + 16 * entries.findIndex( ( e ) => e.tag === 'head' ) + 8 ) );
	const header = new Writer()
		.tag( 'wOFF' )
		.u32( 0x00010000 )
		.u32( offset )
		.u16( count )
		.u16( 0 )
		.u32( totalSfntSize )
		.u16( head.readUInt16BE( 4 ) ) // major version = fontRevision integer part
		.u16( head.readUInt16BE( 6 ) )
		.u32( 0 ).u32( 0 ).u32( 0 ) // metadata
		.u32( 0 ).u32( 0 ); // private data
	return Buffer.concat( [ header.done(), dir.done(), ...bodies ] );
}

/* ------------------------------------------------------------------ */
/* Verification: re-read what was written                              */
/* ------------------------------------------------------------------ */

function check( condition, message ) {
	if ( ! condition ) {
		throw new Error( `verify: ${ message }` );
	}
}

function readTables( sfnt ) {
	check( sfnt.readUInt32BE( 0 ) === 0x00010000, 'sfnt version is not 1.0' );
	const count = sfnt.readUInt16BE( 4 );
	const fields = binarySearchFields( count, 16 );
	check( sfnt.readUInt16BE( 6 ) === fields.searchRange, 'searchRange' );
	check( sfnt.readUInt16BE( 8 ) === fields.entrySelector, 'entrySelector' );
	check( sfnt.readUInt16BE( 10 ) === fields.rangeShift, 'rangeShift' );
	const tables = {};
	let previous = '';
	for ( let i = 0; i < count; i++ ) {
		const at = 12 + i * 16;
		const tag = sfnt.toString( 'latin1', at, at + 4 );
		const sum = sfnt.readUInt32BE( at + 4 );
		const offset = sfnt.readUInt32BE( at + 8 );
		const length = sfnt.readUInt32BE( at + 12 );
		check( tag > previous, `table directory not sorted at ${ tag }` );
		previous = tag;
		check( offset % 4 === 0, `${ tag } is not 4-byte aligned` );
		check( offset + length <= sfnt.length, `${ tag } runs past the end of the file` );
		const data = Buffer.from( sfnt.subarray( offset, offset + pad4( length ) ) );
		if ( tag === 'head' ) {
			data.writeUInt32BE( 0, 8 );
		}
		check( checksum( data ) === sum, `${ tag } checksum mismatch` );
		tables[ tag ] = sfnt.subarray( offset, offset + length );
	}
	check( checksum( sfnt ) === 0xb1b0afba, 'whole-font checksum (head.checkSumAdjustment) is wrong' );
	return tables;
}

function cmapLookup( cmap ) {
	const count = cmap.readUInt16BE( 2 );
	let sub = null;
	for ( let i = 0; i < count; i++ ) {
		const at = 4 + i * 8;
		if ( cmap.readUInt16BE( at ) === 3 && cmap.readUInt16BE( at + 2 ) === 1 ) {
			sub = cmap.subarray( cmap.readUInt32BE( at + 4 ) );
		}
	}
	check( sub && sub.readUInt16BE( 0 ) === 4, 'no (3,1) format 4 cmap subtable' );
	const segCount = sub.readUInt16BE( 6 ) / 2;
	const ends = 14;
	const starts = ends + segCount * 2 + 2;
	const deltas = starts + segCount * 2;
	const ranges = deltas + segCount * 2;
	check( sub.readUInt16BE( ends + ( segCount - 1 ) * 2 ) === 0xffff, 'cmap does not end with the 0xFFFF segment' );
	return ( code ) => {
		for ( let i = 0; i < segCount; i++ ) {
			const end = sub.readUInt16BE( ends + i * 2 );
			if ( code > end ) {
				continue;
			}
			const start = sub.readUInt16BE( starts + i * 2 );
			if ( code < start ) {
				return 0;
			}
			check( sub.readUInt16BE( ranges + i * 2 ) === 0, 'unexpected idRangeOffset' );
			return ( code + sub.readUInt16BE( deltas + i * 2 ) ) & 0xffff;
		}
		return 0;
	};
}

function decodeGlyph( glyf, loca, gid ) {
	const start = loca.readUInt32BE( gid * 4 );
	const end = loca.readUInt32BE( gid * 4 + 4 );
	if ( start === end ) {
		return [];
	}
	const g = glyf.subarray( start, end );
	const contours = g.readInt16BE( 0 );
	check( contours > 0, `glyph ${ gid } is not a simple glyph` );
	const endPts = [];
	for ( let i = 0; i < contours; i++ ) {
		endPts.push( g.readUInt16BE( 10 + i * 2 ) );
	}
	const total = endPts[ endPts.length - 1 ] + 1;
	let at = 10 + contours * 2;
	at += 2 + g.readUInt16BE( at );
	const flags = [];
	while ( flags.length < total ) {
		const flag = g[ at++ ];
		flags.push( flag );
		if ( flag & 0x08 ) {
			for ( let r = g[ at++ ]; r > 0; r-- ) {
				flags.push( flag );
			}
		}
	}
	const readAxis = ( shortBit, sameBit ) => {
		const out = [];
		let v = 0;
		for ( const flag of flags ) {
			if ( flag & shortBit ) {
				const d = g[ at++ ];
				v += flag & sameBit ? d : -d;
			} else if ( ! ( flag & sameBit ) ) {
				v += g.readInt16BE( at );
				at += 2;
			}
			out.push( v );
		}
		return out;
	};
	const xs = readAxis( 0x02, 0x10 );
	const ys = readAxis( 0x04, 0x20 );
	check( flags.every( ( f ) => f & 0x01 ), `glyph ${ gid } has off-curve points` );
	const rects = [];
	let first = 0;
	for ( const last of endPts ) {
		check( last - first === 3, `glyph ${ gid } has a contour that is not a rectangle` );
		const p = [ 0, 1, 2, 3 ].map( ( k ) => [ xs[ first + k ], ys[ first + k ] ] );
		let area = 0;
		for ( let k = 0; k < 4; k++ ) {
			const [ ax, ay ] = p[ k ];
			const [ bx, by ] = p[ ( k + 1 ) % 4 ];
			area += ax * by - bx * ay;
		}
		check( area < 0, `glyph ${ gid } has a counter-clockwise contour` );
		rects.push( { x0: p[ 0 ][ 0 ], x1: p[ 2 ][ 0 ], y0: p[ 0 ][ 1 ], y1: p[ 2 ][ 1 ] } );
		first = last + 1;
	}
	return rects;
}

function verifyFont( sfnt, expect ) {
	const t = readTables( sfnt );
	for ( const tag of [ 'OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post' ] ) {
		check( t[ tag ], `missing ${ tag } table` );
	}
	check( t.head.readUInt32BE( 12 ) === 0x5f0f3cf5, 'head magic number' );
	check( t.head.readUInt16BE( 18 ) === expect.upem, 'unitsPerEm' );
	check( t.head.readInt16BE( 50 ) === 1, 'indexToLocFormat should be long' );
	const numGlyphs = t.maxp.readUInt16BE( 4 );
	check( numGlyphs === expect.order.length, 'maxp.numGlyphs' );
	check( t.hhea.readUInt16BE( 34 ) === numGlyphs, 'hhea.numberOfHMetrics' );
	check( t.loca.length === ( numGlyphs + 1 ) * 4, 'loca length' );
	check( t.hmtx.length === numGlyphs * 4, 'hmtx length' );
	check( t[ 'OS/2' ].readUInt16BE( 0 ) === 4 && t[ 'OS/2' ].length === 96, 'OS/2 is not version 4' );
	check( t[ 'OS/2' ].readUInt16BE( 62 ) & 0x80, 'USE_TYPO_METRICS is not set' );
	check( t.post.readUInt32BE( 0 ) === 0x00030000, 'post is not format 3' );

	const lookup = cmapLookup( t.cmap );
	for ( const code of expect.codes ) {
		check( lookup( code ) === expect.order.indexOf( code ), `cmap maps U+${ code.toString( 16 ) } to the wrong glyph` );
	}
	const gidA = lookup( 0x41 );
	check( gidA > 0, "cmap does not map 'A'" );
	check( decodeGlyph( t.glyf, t.loca, gidA ).length > 0, "'A' has no contours" );

	expect.glyphs.forEach( ( g, gid ) => {
		const rects = decodeGlyph( t.glyf, t.loca, gid );
		check( JSON.stringify( rects ) === JSON.stringify( g.rects ), `glyph ${ gid } outline does not round-trip` );
		check( t.hmtx.readUInt16BE( gid * 4 ) === g.advance, `glyph ${ gid } advance` );
	} );

	const names = {};
	const count = t.name.readUInt16BE( 2 );
	const strings = t.name.readUInt16BE( 4 );
	for ( let i = 0; i < count; i++ ) {
		const at = 6 + i * 12;
		const length = t.name.readUInt16BE( at + 8 );
		const offset = strings + t.name.readUInt16BE( at + 10 );
		names[ t.name.readUInt16BE( at + 6 ) ] = Buffer.from( t.name.subarray( offset, offset + length ) ).swap16().toString( 'utf16le' );
	}
	check( names[ 1 ] === expect.family, 'name: family' );
	check( names[ 0 ] === COPYRIGHT && names[ 13 ] === LICENSE, 'name: copyright / license' );
	return t;
}

function verifyWoff( woff, sfntTables ) {
	check( woff.toString( 'latin1', 0, 4 ) === 'wOFF', 'WOFF signature' );
	check( woff.readUInt32BE( 8 ) === woff.length, 'WOFF length field' );
	const count = woff.readUInt16BE( 12 );
	check( count === Object.keys( sfntTables ).length, 'WOFF table count' );
	let total = 12 + 16 * count;
	for ( let i = 0; i < count; i++ ) {
		const at = 44 + i * 20;
		const tag = woff.toString( 'latin1', at, at + 4 );
		const offset = woff.readUInt32BE( at + 4 );
		const compLength = woff.readUInt32BE( at + 8 );
		const origLength = woff.readUInt32BE( at + 12 );
		const sum = woff.readUInt32BE( at + 16 );
		check( offset % 4 === 0, `WOFF ${ tag } alignment` );
		const stored = woff.subarray( offset, offset + compLength );
		const data = compLength < origLength ? inflateSync( stored ) : stored;
		check( data.equals( sfntTables[ tag ] ), `WOFF ${ tag } does not match the TrueType table` );
		const forSum = Buffer.from( padded( data ) );
		if ( tag === 'head' ) {
			forSum.writeUInt32BE( 0, 8 );
		}
		check( checksum( forSum ) === sum, `WOFF ${ tag } checksum` );
		total += pad4( origLength );
	}
	check( woff.readUInt32BE( 16 ) === total, 'WOFF totalSfntSize' );
}

/* ------------------------------------------------------------------ */

function main() {
	const only = process.argv.slice( 2 );
	const unknown = only.filter( ( name ) => ! FONTS.some( ( f ) => f.file === name ) );
	if ( unknown.length ) {
		fail( 'build-fonts', `unknown font ${ unknown.join( ', ' ) }; expected one of ${ FONTS.map( ( f ) => f.file ).join( ', ' ) }` );
	}
	mkdirSync( OUT, { recursive: true } );
	for ( const { source, file } of FONTS.filter( ( f ) => ! only.length || only.includes( f.file ) ) ) {
		const font = loadFont( source );
		const { sfnt, info, expect } = buildFont( font );
		const woff = buildWoff( sfnt );
		writeFileSync( join( OUT, `${ file }.woff` ), woff );

		const tables = verifyFont( sfnt, expect );
		verifyWoff( readFileSync( join( OUT, `${ file }.woff` ) ), tables );

		const missing = [];
		for ( let c = 0x20; c <= 0x7e; c++ ) {
			if ( ! font.glyphs.has( c ) ) {
				missing.push( String.fromCharCode( c ) );
			}
		}
		const overflow = info.winAscent > info.ascent || info.winDescent > info.descent;
		console.log(
			`${ file }: "${ info.family }" ${ info.style } (${ info.weight }), ${ info.glyphCount } glyphs (${ info.composed } built from others), ` +
			`${ info.size }px, upem ${ info.upem }, ascent ${ info.ascent }px + descent ${ info.descent }px = ` +
			`line-height ${ info.ascent + info.descent }px${ overflow ? `, ink reaches +${ info.winAscent }/-${ info.winDescent }px` : '' }; ` +
			`ttf ${ sfnt.length } B, woff ${ woff.length } B` +
			( missing.length ? `; MISSING ASCII: ${ missing.join( ' ' ) }` : '' )
		);
	}
	console.log( 'All fonts verified.' );
}

main();
