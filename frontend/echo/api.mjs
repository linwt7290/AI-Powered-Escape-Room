import {API_PATHS} from '../../shared/api-paths.mjs';
import {locale, t} from '../ui-language.mjs';

async function postJson(path, payload, signal) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'Accept-Language': locale()},
    body: JSON.stringify(payload), signal
  });
  return {ok: response.ok, data: await response.json()};
}

export async function checkEchoConfig(echoSettings, signal) {
  const result = await postJson(API_PATHS.echoConfig, {echoSettings}, signal).catch(() => null);
  const {mode, error} = result?.data ?? {};
  if (result?.ok && ['model', 'demo', 'incomplete', 'offline'].includes(mode)) return mode;
  throw new Error(typeof error === 'string' ? error : t('暂时无法验证 ECHO 设置，请重试。'));
}

export function sendEchoMessage(payload, signal) {
  return postJson(API_PATHS.echo, payload, signal);
}
