/**
 * 消息通知工具
 * 通过 Router (飞书等企业 IM) 主动通知用户
 */

import type { Tool, ToolResult } from '../types';
import { readStringParam, jsonResult, errorResult } from '../common';
import { Logger } from '../../utils/logger';

const log = new Logger('NotifyTool');

export interface NotifyToolOptions {
    /** RouterBridge 实例引用 */
    getRouterBridge: () => { send: (msg: any) => boolean; getStatus: () => { connected: boolean; bound: boolean } };
    /** 获取最近的入站用户信息 */
    getLastUser: () => { platform_type: string; platform_id: string; platform_user_id: string } | null;
}

/**
 * 创建消息通知工具
 */
export function createNotifyTool(opts: NotifyToolOptions): Tool {
    return {
        name: 'notify_user',
        description: 'Send notification messages to users via enterprise IM (e.g., Feishu/Lark). Suitable for task completion notifications, progress reports, and alerts. Note: Router must be connected with inbound message history.',
        parameters: {
            message: {
                type: 'string',
                description: 'Notification content to send (plain text supported)',
                required: true,
            },
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            try {
                const message = readStringParam(args, 'message', { required: true, label: 'message' });

                // 检查 Router 连接状态
                const bridge = opts.getRouterBridge();
                const status = bridge.getStatus();
                if (!status.connected) {
                    return errorResult('Router not connected, cannot send notifications. Please configure and connect Router in settings first.');
                }
                if (!status.bound) {
                    return errorResult('Router not bound, cannot send notifications. Please complete Router binding first.');
                }

                // 获取最近的入站用户
                const lastUser = opts.getLastUser();
                if (!lastUser) {
                    return errorResult(
                        'No user to notify. At least one inbound message from Feishu/Lark is required to determine the notification recipient.'
                    );
                }

                // 发送通知
                const sent = bridge.send({
                    platform_type: lastUser.platform_type,
                    platform_id: lastUser.platform_id,
                    platform_user_id: lastUser.platform_user_id,
                    content_type: 'text',
                    content: message,
                });

                if (sent) {
                    log.info('Notification sent', {
                        platform: lastUser.platform_type,
                        userId: lastUser.platform_user_id,
                        messageLength: message.length,
                    });
                    return jsonResult({
                        success: true,
                        message: 'Notification sent',
                        platform: lastUser.platform_type,
                        userId: lastUser.platform_user_id,
                    });
                } else {
                    return errorResult('Message sending failed, Router may have disconnected.');
                }
            } catch (err: any) {
                log.error('Notification send failed', { error: err.message });
                return errorResult(`Notification sending failed: ${err.message}`);
            }
        },
    };
}
