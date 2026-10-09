// Which file under icons/ paints which icon slot. The files are drawn
// in icons.txt and written by build-icons.mjs.
//
// Dock tiles are addressed by their menu id (`APP:menu-posts`); a
// window's own button in the taskbar by its window id
// (`APP:edit-php`), so the pages that open in a window get both.
const DOCK = {
	dashboard: [ 'menu-dashboard', 'index-php', 'desktop-mode-dashboard' ],
	posts: [ 'menu-posts', 'edit-php', 'post-new-php', 'desktop-mode-posts' ],
	media: [ 'menu-media', 'upload-php' ],
	pages: [ 'menu-pages', 'edit-php-post_type-page', 'desktop-mode-pages' ],
	comments: [ 'menu-comments', 'edit-comments-php', 'desktop-mode-comments' ],
	appearance: [ 'menu-appearance', 'themes-php' ],
	plugins: [ 'menu-plugins', 'plugins-php', 'desktop-mode-plugins' ],
	users: [ 'menu-users', 'users-php', 'profile-php', 'desktop-mode-users', 'desktop-mode-user-edit' ],
	tools: [ 'menu-tools', 'tools-php' ],
	settings: [ 'menu-settings', 'options-general-php' ],
	assistant: [ 'os-site-assistant' ],
	mio: [ 'os-mio-toggle' ],
	workspaces: [ 'os-overview' ],
	system: [ 'os-system' ],
	start: [ 'os-taskbar-start' ],
};

const DESK = {
	explorer: [ 'my-wordpress' ],
	corkboard: [ 'desktop-mode-content-graph' ],
};

const FILES = {
	FOLDER: 'desk-folder',
	FILE_SHORTCUT: 'desk-shortcut',
	FILE_POST: 'desk-document',
	FILE_ATTACHMENT: 'desk-image',
	FILE_UPLOAD: 'desk-file',
	FILE_USER: 'desk-user',
	FILE_TERM: 'desk-tag',
	FILE_COMMENT: 'desk-comment',
	FILE_BOOKMARK: 'desk-bookmark',
	FILE_LINK: 'desk-link',
	FILE_EMBED: 'desk-embed',
	DEFAULT_APP_ICON: 'desk-app',
	OS_SETTINGS: 'dock-settings',
	EXIT_OPENSTATION: 'dock-exit',
	RECYCLE_BIN: 'dock-trash',
};

export function iconMap() {
	const map = {};
	const image = ( file ) => ( { type: 'image', path: `icons/${ file }.svg` } );
	for ( const [ name, ids ] of Object.entries( DOCK ) ) {
		for ( const id of ids ) {
			map[ `APP:${ id }` ] = image( `dock-${ name }` );
		}
	}
	for ( const [ name, ids ] of Object.entries( DESK ) ) {
		for ( const id of ids ) {
			map[ `APP:${ id }` ] = image( `desk-${ name }` );
		}
	}
	for ( const [ slot, file ] of Object.entries( FILES ) ) {
		map[ slot ] = image( file );
	}
	return map;
}
