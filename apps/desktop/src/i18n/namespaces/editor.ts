/**
 * The editor surface: the formatting toolbar, the status bar, the view switch, and the
 * in-document widgets (tables, images, floats, doc stats).
 */
export const editor = {
  en: {
    toolbar: {
      heading: 'Heading',
      headingLevel: 'Heading {n}',
      bold: 'Bold',
      italic: 'Italic',
      strike: 'Strikethrough',
      inlineCode: 'Inline code',
      link: 'Link',
      image: 'Image',
      listUnordered: 'Unordered list',
      listOrdered: 'Ordered list',
      listTask: 'Task list',
      quote: 'Quote',
      codeBlock: 'Code block',
      hr: 'Horizontal rule',
      insertComponent: 'Insert MDX component',
    },

    docstats: {
      title: 'Stats',
      words: 'Words',
      chars: 'Characters',
      paragraphs: 'Paragraphs',
      images: 'Images',
      citations: 'Citations',
      readMinutes: 'Read time',
      tasks: 'Tasks',
      noTasks: 'No tasks in this document.',
    },

    status: {
      aiThinking: 'AI is thinking…',
      words: '{n} words',
      chars: '{n} chars',
      readMinutes: '~{n} min',
      tasks: '{done}/{total} tasks done',
      saving: 'Saving',
      dirty: 'Unsaved',
      // The last save attempt did not land. A statement of what happened, not
      // advice: the reason (read-only, a full disk, a file that changed under
      // the tab) is said once in the toast, and "please retry" is wrong for the
      // refusals a retry cannot fix.
      failed: 'Save failed',
      saved: 'Saved',
      source: 'Source',
      rendered: 'Rendered',
      split: 'Split',
    },

    viewswitch: {
      source: 'Source',
      rendered: 'Rendered',
      split: 'Split',
      aria: 'View switch',
    },

    floatToolbar: {
      bringForward: 'Bring forward',
      sendBackward: 'Send backward',
    },

    editorPane: {
      resizeSplit: 'Adjust split ratio',
      emptyTitle: 'Open a file from the left to start writing',
      emptyHint: 'Ctrl+S save · Ctrl+Z undo · supports math, citations and MDX components',
    },

    rendered: {
      parseFailed: 'Document parse failed; switched to source view, check the document format',
      saveImageNoVault: 'No vault is open; cannot save the image',
    },

    imageNode: {
      retry: 'Retry',
      missingSource: 'Missing image source',
      loadFailed: 'Image failed to load',
      remoteBlocked: 'Remote image not loaded (blocked by the security policy)',
      openInBrowser: 'Open in browser',
    },

    imagePanel: {
      aria: 'Image properties',
      title: 'Image',
      alt: 'Alt text',
      titleField: 'Title',
      link: 'Link',
      width: 'Width',
      height: 'Height',
      /** The panel's word for "no number is stored" — the half the browser works
       *  out for itself. It reads in the size row and in the empty fields. */
      auto: 'auto',
      align: 'Align',
      alignLeft: 'Left',
      alignCenter: 'Center',
      alignRight: 'Right',
      lockRatio: 'Lock ratio',
      /** Said when the lock has no ratio to hold: neither attribute is set and
       *  the file's own size is not known yet. */
      lockUnavailable: 'Not available yet — this image’s own size is not known',
      currentSize: 'Current',
      originalSize: 'Original',
      /** The dash in the Original row, which for a vault image is what the
       *  panel used to show for every picture (it probed the raw src). */
      originalUnknown: 'Not known — the image has not loaded',
      restoreSize: 'Restore size',
      refresh: 'Refresh image',
      replace: 'Replace',
      delete: 'Delete',
    },

    tableMenu: {
      addRowAfter: 'Add row below',
      addRowBefore: 'Add row above',
      deleteRow: 'Delete row',
      addColAfter: 'Add column right',
      addColBefore: 'Add column left',
      deleteCol: 'Delete column',
      toggleHeader: 'Header row',
      alignLeft: 'Align left',
      alignCenter: 'Align center',
      alignRight: 'Align right',
      aria: 'Table actions',
      /** Said when a table action refuses — the header row and the last
       *  remaining row/column cannot be deleted, and a control that does
       *  nothing in silence reads as broken rather than as a refusal. */
      refused: 'Not available here — the header row and the last row or column stay',
    },
  },
  zh: {
    toolbar: {
      heading: '标题',
      headingLevel: '标题 {n}',
      bold: '加粗',
      italic: '斜体',
      strike: '删除线',
      inlineCode: '行内代码',
      link: '链接',
      image: '图片',
      listUnordered: '无序列表',
      listOrdered: '有序列表',
      listTask: '任务列表',
      quote: '引用',
      codeBlock: '代码块',
      hr: '分隔线',
      insertComponent: '插入 MDX 组件',
    },

    docstats: {
      title: '统计',
      words: '词',
      chars: '字符',
      paragraphs: '段落',
      images: '图片',
      citations: '引用',
      readMinutes: '阅读时间',
      tasks: '任务',
      noTasks: '本文档中没有任务。',
    },

    status: {
      aiThinking: 'AI 思考中…',
      words: '{n} 词',
      chars: '{n} 字符',
      readMinutes: '约 {n} 分钟',
      tasks: '已完成 {done}/{total} 任务',
      saving: '保存中',
      dirty: '未保存',
      // See the English entry: the state, not the reason and not the advice.
      failed: '保存失败',
      saved: '已保存',
      source: '源码',
      rendered: '渲染',
      split: '对照',
    },

    viewswitch: {
      source: '源码',
      rendered: '渲染',
      split: '对照',
      aria: '视图切换',
    },

    floatToolbar: {
      bringForward: '置前',
      sendBackward: '置后',
    },

    editorPane: {
      resizeSplit: '调整分屏比例',
      emptyTitle: '从左侧打开一个文件开始写作',
      emptyHint: 'Ctrl+S 保存 · Ctrl+Z 撤销 · 支持数学公式、引用与 MDX 组件',
    },

    rendered: {
      parseFailed: '文档解析失败，已切换到源码视图，请检查文档格式',
      saveImageNoVault: '尚未打开 vault，无法保存图片',
    },

    imageNode: {
      retry: '重试',
      missingSource: '缺少图片地址',
      loadFailed: '图片加载失败',
      remoteBlocked: '远程图片未加载（受安全策略限制）',
      openInBrowser: '在浏览器中打开',
    },

    imagePanel: {
      aria: '图片属性',
      title: '图片',
      alt: '替代文本',
      titleField: '标题',
      link: '链接',
      width: '宽度',
      height: '高度',
      /** 「没有存数字」的说法——那一半由浏览器自己算。尺寸行与空输入框都用它。 */
      auto: '自动',
      align: '对齐',
      alignLeft: '左对齐',
      alignCenter: '居中',
      alignRight: '右对齐',
      lockRatio: '锁定比例',
      /** 没有比例可锁时（两个属性都没设、也还不知道图片本身尺寸）的说明。 */
      lockUnavailable: '暂不可用——尚不知道该图片本身的尺寸',
      currentSize: '当前尺寸',
      originalSize: '原始尺寸',
      /** 原始尺寸里的那个「—」：vault 图片以前每一张都是这个（探测的是原始 src）。 */
      originalUnknown: '未知——图片尚未加载',
      restoreSize: '恢复尺寸',
      refresh: '刷新图片',
      replace: '替换图片',
      delete: '删除图片',
    },

    tableMenu: {
      addRowAfter: '下方添加行',
      addRowBefore: '上方添加行',
      deleteRow: '删除行',
      addColAfter: '右侧添加列',
      addColBefore: '左侧添加列',
      deleteCol: '删除列',
      toggleHeader: '首行为表头',
      alignLeft: '左对齐',
      alignCenter: '居中',
      alignRight: '右对齐',
      aria: '表格操作',
      /** 表格操作被拒绝时的说明：表头行与最后一行/列不能删除，静默无反应的按钮
       *  会被当成故障，而不是一次拒绝。 */
      refused: '此处不可用——表头行与最后一行/列保留',
    },
  },
}
