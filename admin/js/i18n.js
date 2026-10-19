/**
 * 灵屏 LumaSign · 多语言字典（v1.3.32）
 * 支持语言：zh-CN（中文简体，默认）、zh-TW（中文繁体）、en-US（英文）
 *
 * 用法：
 *   import { t, useI18n, I18N } from './i18n.js'
 *   const msg = t('common.save')        // 按 key 查表
 *   const { t, lang, setLang } = useI18n()
 *
 * 兼容 Chromium 33：使用 ES5 语法（无箭头函数、无对象展开、无 template literal）。
 */
(function () {
  'use strict'
  var DICT = {
    'zh-CN': {
      'app.name': '灵屏 LumaSign',
      'app.tag': '智能数字标牌系统',
      'app.loading': '加载中…',
      'common.save': '保存',
      'common.cancel': '取消',
      'common.delete': '删除',
      'common.edit': '编辑',
      'common.add': '添加',
      'common.confirm': '确认',
      'common.close': '关闭',
      'common.search': '搜索',
      'common.upload': '上传',
      'common.download': '下载',
      'common.refresh': '刷新',
      'common.settings': '设置',
      'common.language': '语言',
      'common.status': '状态',
      'common.name': '名称',
      'common.type': '类型',
      'common.time': '时间',
      'common.actions': '操作',
      'common.enabled': '启用',
      'common.disabled': '禁用',
      'common.yes': '是',
      'common.no': '否',
      'common.all': '全部',
      'common.none': '无',
      'common.error': '错误',
      'common.success': '成功',
      'common.failed': '失败',
      'nav.terminals': '终端管理',
      'nav.schedules': '节目排期',
      'nav.layouts': '节目编辑',
      'nav.media': '素材库',
      'nav.datasources': '数据源',
      'nav.monitors': '监控中心',
      'nav.settings': '系统设置',
      'nav.interactions': '交互数据',
      'nav.siqian': '56iq兼容',
      'nav.users': '用户管理',
      'nav.dashboard': '仪表盘',
      'nav.approvals': '审批中心',
      'nav.lifecycle': '内容生命周期',
      'nav.health': '健康看板',
      'nav.proof': '播放证明',
      'nav.fleet': '设备开通',
      'nav.crashLogs': '崩溃日志',
      'nav.logs': '日志与播放证明',
      'nav.security': '安全中心',
      'nav.group.overview': '总览',
      'nav.group.ops': '运营',
      'nav.group.system': '系统',
      'common.theme.light': '浅色',
      'common.theme.dark': '深色',
      'common.theme.system': '跟随系统',
      'layout.editor': '节目编辑器',
      'layout.regions': '区域',
      'layout.components': '组件库',
      'layout.properties': '属性面板',
      'layout.preview': '实时预览',
      'layout.publish': '发布节目',
      'layout.unsaved': '有未保存的修改',
      'components.image': '图片',
      'components.video': '视频',
      'components.text': '文字',
      'components.marquee': '跑马灯',
      'components.border-marquee': '边框滚动字',
      'components.clock': '实时时钟',
      'components.date': '日期窗',
      'components.weekday': '星期窗',
      'components.weather': '天气窗',
      'components.logo': 'LOGO 水印',
      'components.qrcode': '二维码',
      'components.meeting': '会议室',
      'components.timer-play': '定时起播',
      'components.poweroff': '关机倒计时',
      'components.data-text': '模板文本',
      'components.data-number': '数字牌',
      'components.data-chart': '图表',
      'components.form': '交互表单',
      'components.music': '音乐播放',
      'components.dual-mode': '双屏布局',
      'components.info-window': '信息窗口',
      'components.media-section': '图部',
      'components.dynamic-data': '动态数据',
      'components.interaction': '交互表单',
      'transition.fade': '淡入淡出',
      'transition.slide-left': '滑入·左',
      'transition.slide-right': '滑入·右',
      'transition.slide-up': '滑入·上',
      'transition.slide-down': '滑入·下',
      'transition.push-left': '推入·左',
      'transition.push-right': '推入·右',
      'transition.push-up': '推入·上',
      'transition.push-down': '推入·下',
      'transition.wipe-left': '擦除·左',
      'transition.wipe-right': '擦除·右',
      'transition.wipe-up': '擦除·上',
      'transition.wipe-down': '擦除·下',
      'transition.zoom-in': '缩放·近',
      'transition.zoom-out': '缩放·远',
      'transition.spin-in': '旋转·进',
      'transition.spin-out': '旋转·出',
      'transition.flip-h': '翻转·横',
      'transition.flip-v': '翻转·竖',
      'transition.blur-in': '模糊·进',
      'transition.blur-out': '模糊·出',
      'transition.glitch': '故障风',
      'transition.shake': '抖动',
      'transition.flip-book': '翻书',
      'transition.cube': '立方体',
      'transition.none': '无（直接切换）',
      'timer.title': '定时起播',
      'timer.now-playing': '当前播放',
      'timer.countdown': '倒计时',
      'timer.start-time': '开始时间',
      'timer.end-time': '结束时间',
      'timer.content': '节目内容',
      'timer.now': '立即起播',
      'music.title': '音乐播放',
      'music.playlist': '播放列表',
      'music.now-playing': '正在播放',
      'music.lyric': '歌词',
      'music.play': '播放',
      'music.pause': '暂停',
      'music.stop': '停止',
      'music.next': '下一首',
      'music.prev': '上一首',
      'dual.mode': '双屏布局',
      'dual.primary': '主屏',
      'dual.secondary': '副屏',
      'dual.enable': '启用双屏',
      'dual.enable-hint': '需要设备支持多 Display（如 RK312x 双 HDMI）',
      'error.unknown': '未知错误',
      'error.network': '网络异常',
      'error.auth': '认证失败',
    },
    'zh-TW': {
      'app.name': '靈屏 LumaSign',
      'app.tag': '智能數位標牌系統',
      'common.save': '儲存',
      'common.cancel': '取消',
      'common.delete': '刪除',
      'common.edit': '編輯',
      'common.add': '新增',
      'common.confirm': '確認',
      'common.close': '關閉',
      'common.search': '搜尋',
      'common.upload': '上傳',
      'common.download': '下載',
      'common.refresh': '重新整理',
      'common.settings': '設定',
      'common.language': '語言',
      'common.status': '狀態',
      'common.name': '名稱',
      'common.type': '類型',
      'common.time': '時間',
      'common.actions': '操作',
      'common.enabled': '啟用',
      'common.disabled': '停用',
      'common.yes': '是',
      'common.no': '否',
      'common.all': '全部',
      'common.none': '無',
      'common.error': '錯誤',
      'common.success': '成功',
      'common.failed': '失敗',
      'nav.terminals': '終端管理',
      'nav.schedules': '節目排程',
      'nav.layouts': '節目編輯',
      'nav.media': '素材庫',
      'nav.datasources': '資料源',
      'nav.monitors': '監控中心',
      'nav.settings': '系統設定',
      'nav.interactions': '互動資料',
      'nav.siqian': '56iq相容',
      'nav.users': '使用者管理',
      'nav.dashboard': '儀表板',
      'nav.approvals': '審批中心',
      'nav.lifecycle': '內容生命週期',
      'nav.health': '健康看板',
      'nav.proof': '播放證明',
      'nav.fleet': '設備開通',
      'nav.crashLogs': '崩潰日誌',
      'nav.logs': '日誌與播放證明',
      'nav.security': '安全中心',
      'nav.group.overview': '總覽',
      'nav.group.ops': '營運',
      'nav.group.system': '系統',
      'common.theme.light': '淺色',
      'common.theme.dark': '深色',
      'common.theme.system': '跟隨系統',
    },
    'en-US': {
      'app.name': 'LumaSign',
      'app.tag': 'Smart Digital Signage System',
      'app.loading': 'Loading…',
      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.delete': 'Delete',
      'common.edit': 'Edit',
      'common.add': 'Add',
      'common.confirm': 'Confirm',
      'common.close': 'Close',
      'common.search': 'Search',
      'common.upload': 'Upload',
      'common.download': 'Download',
      'common.refresh': 'Refresh',
      'common.settings': 'Settings',
      'common.language': 'Language',
      'common.status': 'Status',
      'common.name': 'Name',
      'common.type': 'Type',
      'common.time': 'Time',
      'common.actions': 'Actions',
      'common.enabled': 'Enabled',
      'common.disabled': 'Disabled',
      'common.yes': 'Yes',
      'common.no': 'No',
      'common.all': 'All',
      'common.none': 'None',
      'common.error': 'Error',
      'common.success': 'Success',
      'common.failed': 'Failed',
      'nav.terminals': 'Terminals',
      'nav.schedules': 'Schedules',
      'nav.layouts': 'Layouts',
      'nav.media': 'Media Library',
      'nav.datasources': 'Data Sources',
      'nav.monitors': 'Monitoring',
      'nav.settings': 'Settings',
      'nav.interactions': 'Interactions',
      'nav.siqian': '56iq Compat',
      'nav.users': 'Users',
      'nav.dashboard': 'Dashboard',
      'nav.approvals': 'Approvals',
      'nav.lifecycle': 'Content Lifecycle',
      'nav.health': 'Health',
      'nav.proof': 'Play Proof',
      'nav.fleet': 'Device Onboarding',
      'nav.crashLogs': 'Crash Logs',
      'nav.logs': 'Logs',
      'nav.security': 'Security',
      'nav.group.overview': 'Overview',
      'nav.group.ops': 'Operations',
      'nav.group.system': 'System',
      'common.theme.light': 'Light',
      'common.theme.dark': 'Dark',
      'common.theme.system': 'System',
      'layout.editor': 'Layout Editor',
      'layout.regions': 'Regions',
      'layout.components': 'Components',
      'layout.properties': 'Properties',
      'layout.preview': 'Live Preview',
      'layout.publish': 'Publish',
      'layout.unsaved': 'Unsaved changes',
      'components.image': 'Image',
      'components.video': 'Video',
      'components.text': 'Text',
      'components.marquee': 'Marquee',
      'components.border-marquee': 'Border Scroll',
      'components.clock': 'Clock',
      'components.date': 'Date',
      'components.weekday': 'Weekday',
      'components.weather': 'Weather',
      'components.logo': 'LOGO',
      'components.qrcode': 'QR Code',
      'components.meeting': 'Meeting',
      'components.timer-play': 'Timer Play',
      'components.poweroff': 'Power Off',
      'components.data-text': 'Template Text',
      'components.data-number': 'Number',
      'components.data-chart': 'Chart',
      'components.form': 'Form',
      'components.music': 'Music',
      'components.dual-mode': 'Dual Display',
      'components.info-window': 'Info Window',
      'components.media-section': 'Media',
      'components.dynamic-data': 'Dynamic Data',
      'components.interaction': 'Forms',
      'timer.title': 'Timer Play',
      'timer.now-playing': 'Now Playing',
      'timer.countdown': 'Countdown',
      'timer.start-time': 'Start Time',
      'timer.end-time': 'End Time',
      'timer.content': 'Content',
      'timer.now': 'Play Now',
      'music.title': 'Music',
      'music.playlist': 'Playlist',
      'music.now-playing': 'Now Playing',
      'music.lyric': 'Lyrics',
      'music.play': 'Play',
      'music.pause': 'Pause',
      'music.stop': 'Stop',
      'music.next': 'Next',
      'music.prev': 'Previous',
      'dual.mode': 'Dual Display',
      'dual.primary': 'Primary',
      'dual.secondary': 'Secondary',
      'dual.enable': 'Enable Dual',
      'dual.enable-hint': 'Requires multi-display hardware (e.g. RK312x dual HDMI)',
      'error.unknown': 'Unknown error',
      'error.network': 'Network error',
      'error.auth': 'Auth failed',
    }
  }

  var DEFAULT_LANG = 'zh-CN'
  var STORAGE_KEY = 'luma_lang'

  var currentLang = DEFAULT_LANG
  try {
    var saved = localStorage.getItem(STORAGE_KEY)
    if (saved && DICT[saved]) currentLang = saved
  } catch (e) { /* localStorage 不可用时静默降级 */ }

  var listeners = []

  function t(key, fallback) {
    var dict = DICT[currentLang] || DICT[DEFAULT_LANG]
    var val = dict[key]
    if (val != null) return val
    // 语言包缺失时回退到默认语言
    if (currentLang !== DEFAULT_LANG) {
      var def = (DICT[DEFAULT_LANG] || {})[key]
      if (def != null) return def
    }
    return fallback != null ? fallback : key
  }

  function getLang() { return currentLang }

  function setLang(lang) {
    if (!DICT[lang]) lang = DEFAULT_LANG
    if (lang === currentLang) return
    currentLang = lang
    try { localStorage.setItem(STORAGE_KEY, lang) } catch (e) { /* ignore */ }
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](lang) } catch (e) { /* ignore */ }
    }
  }

  function onLangChange(fn) {
    if (typeof fn === 'function') listeners.push(fn)
  }

  function languages() {
    return [
      { code: 'zh-CN', label: '简体中文', short: '中' },
      { code: 'zh-TW', label: '繁體中文', short: '繁' },
      { code: 'en-US', label: 'English', short: 'EN' }
    ]
  }

  // 自动同步 document.lang
  function applyToDom() {
    try { document.documentElement.lang = currentLang } catch (e) { /* ignore */ }
  }
  applyToDom()
  onLangChange(applyToDom)

  // 暴露到 window 便于全局使用
  window.I18N = { t: t, lang: getLang, setLang: setLang, on: onLangChange, languages: languages, dict: DICT }
})();
