/* 定时唤醒端点：由 cron-job.org 等外部定时器每分钟调用一次，
   检查所有订阅的提醒任务并发送到期的 Web Push 通知。 */
const { json, processCheck } = require('./_lib/push-lib.js');

export async function onRequest(context) {
  return json(200, await processCheck(context.env));
}
