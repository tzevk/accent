'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
	Bold,
	Italic,
	List,
	ListOrdered,
	Quote,
	Heading1,
	Heading2,
	Undo,
	Redo,
} from 'lucide-react';

export default function RichTextEditor({
	label,
	value,
	onChange,
	placeholder = 'Enter text...',
	rows = 6,
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

	const toolbarButtons = [
		{
			icon: Bold,
			command: () => editor.chain().focus().toggleBold().run(),
			isActive: () => editor.isActive('bold'),
			title: 'Bold',
		},
		{
			icon: Italic,
			command: () => editor.chain().focus().toggleItalic().run(),
			isActive: () => editor.isActive('italic'),
			title: 'Italic',
		},
		{ separator: true },
		{
			icon: Heading1,
			command: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
			isActive: () => editor.isActive('heading', { level: 1 }),
			title: 'Heading 1',
		},
		{
			icon: Heading2,
			command: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
			isActive: () => editor.isActive('heading', { level: 2 }),
			title: 'Heading 2',
		},
		{ separator: true },
		{
			icon: List,
			command: () => editor.chain().focus().toggleBulletList().run(),
			isActive: () => editor.isActive('bulletList'),
			title: 'Bullet List',
		},
		{
			icon: ListOrdered,
			command: () => editor.chain().focus().toggleOrderedList().run(),
			isActive: () => editor.isActive('orderedList'),
			title: 'Numbered List',
		},
		{ separator: true },
		{
			icon: Quote,
			command: () => editor.chain().focus().toggleBlockquote().run(),
			isActive: () => editor.isActive('blockquote'),
			title: 'Quote',
		},
		{ separator: true },
		{
			icon: Undo,
			command: () => editor.chain().focus().undo().run(),
			isActive: () => false,
			title: 'Undo',
		},
		{
			icon: Redo,
			command: () => editor.chain().focus().redo().run(),
			isActive: () => false,
			title: 'Redo',
		},
	];

	return (
		<div>
			{label && (
				<label className="block text-sm font-medium text-gray-700 mb-2">
					{label}
				</label>
			)}
			<div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
				{/* Toolbar */}
				<div className="flex flex-wrap items-center gap-1 px-3 py-2 bg-gray-50 border-b border-gray-200">
					{toolbarButtons.map((button, index) =>
						button.separator ? (
							<div key={`sep-${index}`} className="w-px h-5 bg-gray-300 mx-1" />
						) : (
							<button
								key={button.title}
								onClick={(e) => {
									e.preventDefault();
									button.command();
								}}
								title={button.title}
								className={`p-1.5 rounded transition-colors ${
									button.isActive()
										? 'bg-green-100 text-green-700'
										: 'text-gray-600 hover:bg-gray-200'
								}`}
							>
								<button.icon className="h-4 w-4" />
							</button>
						)
					)}
				</div>

				{/* Editor Content */}
				<div className="p-3 min-h-[150px]">
					<EditorContent editor={editor} placeholder={placeholder} />
				</div>
			</div>
		</div>
	);
}

import { useEffect } from 'react';
