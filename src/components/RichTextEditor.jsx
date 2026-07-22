'use client';

import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import {
	Bold,
	Italic,
	Underline,
	Strikethrough,
	List,
	ListOrdered,
	Quote,
	Heading1,
	Heading2,
	Undo,
	Redo,
} from 'lucide-react';

const TOOLBAR_BUTTONS = [
	{
		icon: Bold,
		command: (editor) => editor.chain().focus().toggleBold().run(),
		isActive: (editor) => editor.isActive('bold'),
		title: 'Bold',
	},
	{
		icon: Italic,
		command: (editor) => editor.chain().focus().toggleItalic().run(),
		isActive: (editor) => editor.isActive('italic'),
		title: 'Italic',
	},
	{
		icon: Underline,
		command: (editor) => editor.chain().focus().toggleUnderline().run(),
		isActive: (editor) => editor.isActive('underline'),
		title: 'Underline',
	},
	{
		icon: Strikethrough,
		command: (editor) => editor.chain().focus().toggleStrike().run(),
		isActive: (editor) => editor.isActive('strike'),
		title: 'Strikethrough',
	},
	{ separator: true },
	{
		icon: Heading1,
		command: (editor) =>
			editor.chain().focus().toggleHeading({ level: 1 }).run(),
		isActive: (editor) => editor.isActive('heading', { level: 1 }),
		title: 'Heading 1',
	},
	{
		icon: Heading2,
		command: (editor) =>
			editor.chain().focus().toggleHeading({ level: 2 }).run(),
		isActive: (editor) => editor.isActive('heading', { level: 2 }),
		title: 'Heading 2',
	},
	{ separator: true },
	{
		icon: List,
		command: (editor) => editor.chain().focus().toggleBulletList().run(),
		isActive: (editor) => editor.isActive('bulletList'),
		title: 'Bullet List',
	},
	{
		icon: ListOrdered,
		command: (editor) => editor.chain().focus().toggleOrderedList().run(),
		isActive: (editor) => editor.isActive('orderedList'),
		title: 'Numbered List',
	},
	{
		icon: Quote,
		command: (editor) => editor.chain().focus().toggleBlockquote().run(),
		isActive: (editor) => editor.isActive('blockquote'),
		title: 'Quote',
	},
	{ separator: true },
	{
		icon: Undo,
		command: (editor) => editor.chain().focus().undo().run(),
		isActive: () => false,
		title: 'Undo',
	},
	{
		icon: Redo,
		command: (editor) => editor.chain().focus().redo().run(),
		isActive: () => false,
		title: 'Redo',
	},
];

function FormatButton({ button, editor, size = 'h-4 w-4' }) {
	return (
		<button
			type="button"
			onMouseDown={(e) => {
				e.preventDefault();
				button.command(editor);
			}}
			title={button.title}
			className={`p-1.5 rounded transition-colors ${
				button.isActive(editor)
					? 'bg-purple-100 text-purple-700'
					: 'text-gray-600 hover:bg-gray-200'
			}`}
		>
			<button.icon className={size} />
		</button>
	);
}

function Separator() {
	return <div className="w-px h-5 bg-gray-300 mx-1" />;
}

export default function RichTextEditor({
	label,
	value,
	onChange,
	placeholder = 'Enter text...',
	rows = 6,
	variant = 'toolbar',
}) {
	const editor = useEditor({
		extensions: [StarterKit],
		content: value || '',
		onUpdate: ({ editor }) => {
			onChange(editor.getHTML());
		},
		editorProps: {
			attributes: {
				class:
					'rich-text-content max-w-none focus:outline-none min-h-full cursor-text',
			},
		},
	});

	// Update editor content when value prop changes (for initial load)
	useEffect(() => {
		if (editor && value !== editor.getHTML()) {
			editor.commands.setContent(value || '');
		}
	}, [editor, value]);

	if (!editor) {
		return (
			<div className="border border-gray-300 rounded-lg p-3 bg-gray-50">
				<div className="h-32 flex items-center justify-center text-gray-400 text-sm">
					Loading editor...
				</div>
			</div>
		);
	}

	const renderButtons = (editor, iconSize) =>
		TOOLBAR_BUTTONS.map((button, index) =>
			button.separator ? (
				<Separator key={`sep-${index}`} />
			) : (
				<FormatButton
					key={button.title}
					button={button}
					editor={editor}
					size={iconSize}
				/>
			)
		);

	return (
		<div>
			{label && (
				<label className="block text-sm font-medium text-gray-700 mb-2">
					{label}
				</label>
			)}
			<div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
				{/* Floating selection menu (Microsoft Word style) */}
				{variant === 'bubble' && (
					<BubbleMenu
						editor={editor}
						updateDelay={100}
						options={{
							placement: 'top',
							offset: 8,
							flip: true,
							shift: { padding: { left: 300, top: 8, right: 8, bottom: 8 } },
						}}
						className="flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
					>
						{renderButtons(editor, 'h-4 w-4')}
					</BubbleMenu>
				)}

				{/* Static toolbar (default) */}
				{variant === 'toolbar' && (
					<div className="flex flex-wrap items-center gap-1 px-3 py-2 bg-gray-50 border-b border-gray-200">
						{renderButtons(editor, 'h-4 w-4')}
					</div>
				)}

				{/* Editor Content */}
				<div className="p-3 min-h-[150px]">
					<EditorContent editor={editor} placeholder={placeholder} />
				</div>
			</div>
		</div>
	);
}
