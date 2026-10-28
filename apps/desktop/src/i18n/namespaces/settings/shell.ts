/** The dialog chrome: title, resize grip and section list. */
export const settingsShell = {
  en: {
    dialogTitle: 'Settings',
    /* The dialog's corner grip. `value` is the handle's `aria-valuetext`, so it names both
       numbers rather than only the width `aria-valuenow` reports — the grip moves two axes and
       ARIA's `separator` has only one. */
    resize: {
      label: 'Resize the settings dialog',
      value: '{width} wide, {height} tall',
      hint: 'Drag to resize. Arrow keys move one edge, Home is the smallest, End is the window.',
    },
    section: {
      general: 'General',
      appearance: 'Appearance',
      editor: 'Editor',
      export: 'Export',
      ai: 'AI',
      plugins: 'Plugins',
      about: 'About',
      agents: 'Agents',
      desktopPet: 'Desktop Pet',
    },
  },
  zh: {
    dialogTitle: '设置',
    resize: {
      label: '调整设置窗口大小',
      value: '宽 {width}，高 {height}',
      hint: '拖动可调整大小。方向键移动单边，Home 为最小，End 为窗口大小。',
    },
    section: {
      general: '常规',
      appearance: '外观',
      editor: '编辑器',
      export: '导出',
      ai: 'AI',
      plugins: '插件',
      about: '关于',
      agents: '智能体',
      desktopPet: '桌面宠物',
    },
  },
} as const
