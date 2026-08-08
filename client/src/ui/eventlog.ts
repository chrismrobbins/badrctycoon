/** The scrolling event feed in the bottom-left corner. No state of its own --
 *  reads and writes only the #event-log DOM node. */
export type LogType = 'info' | 'good' | 'bad';

export function logEvent(msg: string, type: LogType = 'info'): void {
  const log = document.getElementById('event-log');
  const div = document.createElement('div');
  div.className = `text-[10px] mb-1 ${type === 'good' ? 'text-green-500 font-bold' : type === 'bad' ? 'text-red-500 font-bold' : 'text-slate-600 dark:text-gray-400'}`;
  div.innerText = msg;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
