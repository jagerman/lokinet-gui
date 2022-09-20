export const SETTINGS_ID_STOP_ON_EXIT = 'on_exit_stop_setting';
export const SETTINGS_ID_SELECTED_THEME = 'selected_theme';

export type OnExitStopSetting =
  | 'stop_everything' // stop daemon and exit
  | 'keep_everything'; // keep exit and daemon as they are currently running

export function getDefaultOnExitDo(): OnExitStopSetting {
  return 'stop_everything';
}
