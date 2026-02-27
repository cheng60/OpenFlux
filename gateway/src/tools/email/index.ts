/**
 * 邮件工具 - SMTP 发送 + IMAP 读取
 * 使用 nodemailer（发送）和 imap-simple（读取）
 */

import type { AnyTool, ToolResult } from '../types';
import {
    readStringParam,
    readNumberParam,
    readBooleanParam,
    validateAction,
    jsonResult,
    errorResult,
} from '../common';

// 支持的动作
const EMAIL_ACTIONS = [
    'send',       // 发送邮件
    'read',       // 读取收件箱
    'search',     // 搜索邮件
    'config',     // 查看/设置配置
] as const;

type EmailAction = (typeof EMAIL_ACTIONS)[number];

export interface EmailToolOptions {
    /** SMTP 主机 */
    smtpHost?: string;
    /** SMTP 端口 */
    smtpPort?: number;
    /** IMAP 主机 */
    imapHost?: string;
    /** IMAP 端口 */
    imapPort?: number;
    /** 邮箱地址 */
    user?: string;
    /** 邮箱密码/授权码 */
    password?: string;
    /** 是否使用 TLS */
    tls?: boolean;
    /** 发送邮件是否需要确认 */
    requireConfirmation?: boolean;
}

/**
 * 创建邮件工具
 */
export function createEmailTool(opts: EmailToolOptions = {}): AnyTool {
    // 运行时配置（可通过 config action 修改）
    let config = {
        smtpHost: opts.smtpHost || '',
        smtpPort: opts.smtpPort || 465,
        imapHost: opts.imapHost || '',
        imapPort: opts.imapPort || 993,
        user: opts.user || '',
        password: opts.password || '',
        tls: opts.tls !== false,
        requireConfirmation: opts.requireConfirmation !== false,
    };

    return {
        name: 'email',
        description: `Email tool. Supported actions: ${EMAIL_ACTIONS.join(', ')}. Use config action to set SMTP/IMAP connection info before use.`,
        parameters: {
            action: {
                type: 'string',
                description: `Action type: ${EMAIL_ACTIONS.join('/')}`,
                required: true,
                enum: [...EMAIL_ACTIONS],
            },
            to: {
                type: 'string',
                description: 'send action: Recipient address (multiple separated by commas)',
            },
            cc: {
                type: 'string',
                description: 'send action: CC address',
            },
            subject: {
                type: 'string',
                description: 'send/search action: Email subject',
            },
            body: {
                type: 'string',
                description: 'send action: Email body',
            },
            html: {
                type: 'boolean',
                description: 'send action: Whether body is HTML format',
                default: false,
            },
            attachments: {
                type: 'string',
                description: 'send action: Attachment file paths (multiple separated by commas)',
            },
            count: {
                type: 'number',
                description: 'read action: Number of emails to read (default 10)',
            },
            folder: {
                type: 'string',
                description: 'read/search action: Email folder (default INBOX)',
            },
            query: {
                type: 'string',
                description: 'search action: Search keyword',
            },
            from: {
                type: 'string',
                description: 'search action: Sender filter',
            },
            // config 参数
            smtpHost: { type: 'string', description: 'config action: SMTP host' },
            smtpPort: { type: 'number', description: 'config action: SMTP port' },
            imapHost: { type: 'string', description: 'config action: IMAP host' },
            imapPort: { type: 'number', description: 'config action: IMAP port' },
            user: { type: 'string', description: 'config action: Email address' },
            password: { type: 'string', description: 'config action: Password/auth code' },
        },

        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            const action = validateAction(args, EMAIL_ACTIONS);

            switch (action) {
                // 查看/设置邮箱配置
                case 'config': {
                    const smtpHost = readStringParam(args, 'smtpHost');
                    const smtpPort = readNumberParam(args, 'smtpPort');
                    const imapHost = readStringParam(args, 'imapHost');
                    const imapPort = readNumberParam(args, 'imapPort');
                    const user = readStringParam(args, 'user');
                    const password = readStringParam(args, 'password');

                    // 如果传入了参数则更新
                    let updated = false;
                    if (smtpHost) { config.smtpHost = smtpHost; updated = true; }
                    if (smtpPort) { config.smtpPort = smtpPort; updated = true; }
                    if (imapHost) { config.imapHost = imapHost; updated = true; }
                    if (imapPort) { config.imapPort = imapPort; updated = true; }
                    if (user) { config.user = user; updated = true; }
                    if (password) { config.password = password; updated = true; }

                    return jsonResult({
                        updated,
                        config: {
                            smtpHost: config.smtpHost || '(not set)',
                            smtpPort: config.smtpPort,
                            imapHost: config.imapHost || '(not set)',
                            imapPort: config.imapPort,
                            user: config.user || '(not set)',
                            password: config.password ? '******' : '(not set)',
                            tls: config.tls,
                        },
                    });
                }

                // 发送邮件（通过 nodemailer）
                case 'send': {
                    if (!config.smtpHost || !config.user || !config.password) {
                        return errorResult('Email not configured. Please use config action to set smtpHost, user, password first.');
                    }

                    const to = readStringParam(args, 'to');
                    const subject = readStringParam(args, 'subject') || '(No Subject)';
                    const body = readStringParam(args, 'body') || '';
                    const cc = readStringParam(args, 'cc');
                    const isHtml = readBooleanParam(args, 'html') || false;
                    const attachmentPaths = readStringParam(args, 'attachments');

                    if (!to) {
                        return errorResult('Missing recipient address (to parameter)');
                    }

                    try {
                        const nodemailer = require('nodemailer');

                        const transporter = nodemailer.createTransport({
                            host: config.smtpHost,
                            port: config.smtpPort,
                            secure: config.tls,
                            auth: {
                                user: config.user,
                                pass: config.password,
                            },
                        });

                        // 构建附件列表
                        const attachments: Array<{ filename: string; path: string }> = [];
                        if (attachmentPaths) {
                            const paths = attachmentPaths.split(',').map(p => p.trim());
                            const pathModule = require('path');
                            for (const p of paths) {
                                attachments.push({
                                    filename: pathModule.basename(p),
                                    path: p,
                                });
                            }
                        }

                        const mailOptions: Record<string, unknown> = {
                            from: config.user,
                            to,
                            subject,
                            attachments,
                        };

                        if (cc) mailOptions.cc = cc;
                        if (isHtml) {
                            mailOptions.html = body;
                        } else {
                            mailOptions.text = body;
                        }

                        const info = await transporter.sendMail(mailOptions);

                        return jsonResult({
                            sent: true,
                            messageId: info.messageId,
                            to,
                            subject,
                            attachmentCount: attachments.length,
                        });
                    } catch (error: any) {
                        return errorResult(`Failed to send email: ${error.message}`);
                    }
                }

                // 读取收件箱（通过 IMAP）
                case 'read': {
                    if (!config.imapHost || !config.user || !config.password) {
                        return errorResult('IMAP not configured. Please use config action to set imapHost, user, password first.');
                    }

                    const count = readNumberParam(args, 'count') || 10;
                    const folder = readStringParam(args, 'folder') || 'INBOX';

                    try {
                        const Imap = require('imap');
                        const { simpleParser } = require('mailparser');

                        const imap = new Imap({
                            user: config.user,
                            password: config.password,
                            host: config.imapHost,
                            port: config.imapPort,
                            tls: config.tls,
                            tlsOptions: { rejectUnauthorized: false },
                        });

                        const emails = await new Promise<any[]>((resolve, reject) => {
                            const results: any[] = [];

                            imap.once('ready', () => {
                                imap.openBox(folder, true, (err: any) => {
                                    if (err) { reject(err); return; }

                                    // 获取最新的 N 封邮件
                                    imap.search(['ALL'], (searchErr: any, uids: number[]) => {
                                        if (searchErr) { reject(searchErr); return; }

                                        const latest = uids.slice(-count);
                                        if (latest.length === 0) {
                                            imap.end();
                                            resolve([]);
                                            return;
                                        }

                                        const fetch = imap.fetch(latest, {
                                            bodies: '',
                                            struct: true,
                                        });

                                        fetch.on('message', (msg: any) => {
                                            msg.on('body', (stream: any) => {
                                                let buffer = '';
                                                stream.on('data', (chunk: any) => { buffer += chunk.toString('utf8'); });
                                                stream.once('end', async () => {
                                                    try {
                                                        const parsed = await simpleParser(buffer);
                                                        results.push({
                                                            from: parsed.from?.text || '',
                                                            to: parsed.to?.text || '',
                                                            subject: parsed.subject || '',
                                                            date: parsed.date?.toISOString() || '',
                                                            text: (parsed.text || '').slice(0, 500),
                                                            hasAttachments: (parsed.attachments?.length || 0) > 0,
                                                            attachmentCount: parsed.attachments?.length || 0,
                                                        });
                                                    } catch {
                                                        // 解析失败忽略
                                                    }
                                                });
                                            });
                                        });

                                        fetch.once('end', () => {
                                            imap.end();
                                            // 延迟一点确保所有解析完成
                                            setTimeout(() => resolve(results), 500);
                                        });

                                        fetch.once('error', reject);
                                    });
                                });
                            });

                            imap.once('error', reject);
                            imap.connect();
                        });

                        return jsonResult({
                            folder,
                            count: emails.length,
                            emails: emails.reverse(), // 最新的在前
                        });
                    } catch (error: any) {
                        return errorResult(`Failed to read emails: ${error.message}`);
                    }
                }

                // 搜索邮件
                case 'search': {
                    if (!config.imapHost || !config.user || !config.password) {
                        return errorResult('IMAP not configured. Please use config action to set imapHost, user, password first.');
                    }

                    const query = readStringParam(args, 'query');
                    const from = readStringParam(args, 'from');
                    const subject = readStringParam(args, 'subject');
                    const folder = readStringParam(args, 'folder') || 'INBOX';
                    const count = readNumberParam(args, 'count') || 20;

                    if (!query && !from && !subject) {
                        return errorResult('Search requires at least one condition: query, from, or subject');
                    }

                    try {
                        const Imap = require('imap');
                        const { simpleParser } = require('mailparser');

                        const imap = new Imap({
                            user: config.user,
                            password: config.password,
                            host: config.imapHost,
                            port: config.imapPort,
                            tls: config.tls,
                            tlsOptions: { rejectUnauthorized: false },
                        });

                        const emails = await new Promise<any[]>((resolve, reject) => {
                            const results: any[] = [];

                            imap.once('ready', () => {
                                imap.openBox(folder, true, (err: any) => {
                                    if (err) { reject(err); return; }

                                    // 构建 IMAP 搜索条件
                                    const criteria: any[] = [];
                                    if (subject) criteria.push(['SUBJECT', subject]);
                                    if (from) criteria.push(['FROM', from]);
                                    if (query) criteria.push(['TEXT', query]);

                                    imap.search(criteria, (searchErr: any, uids: number[]) => {
                                        if (searchErr) { reject(searchErr); return; }

                                        const latest = uids.slice(-count);
                                        if (latest.length === 0) {
                                            imap.end();
                                            resolve([]);
                                            return;
                                        }

                                        const fetch = imap.fetch(latest, {
                                            bodies: '',
                                            struct: true,
                                        });

                                        fetch.on('message', (msg: any) => {
                                            msg.on('body', (stream: any) => {
                                                let buffer = '';
                                                stream.on('data', (chunk: any) => { buffer += chunk.toString('utf8'); });
                                                stream.once('end', async () => {
                                                    try {
                                                        const parsed = await simpleParser(buffer);
                                                        results.push({
                                                            from: parsed.from?.text || '',
                                                            to: parsed.to?.text || '',
                                                            subject: parsed.subject || '',
                                                            date: parsed.date?.toISOString() || '',
                                                            text: (parsed.text || '').slice(0, 300),
                                                        });
                                                    } catch {
                                                        // 忽略
                                                    }
                                                });
                                            });
                                        });

                                        fetch.once('end', () => {
                                            imap.end();
                                            setTimeout(() => resolve(results), 500);
                                        });

                                        fetch.once('error', reject);
                                    });
                                });
                            });

                            imap.once('error', reject);
                            imap.connect();
                        });

                        return jsonResult({
                            folder,
                            query: { query, from, subject },
                            count: emails.length,
                            emails: emails.reverse(),
                        });
                    } catch (error: any) {
                        return errorResult(`Failed to search emails: ${error.message}`);
                    }
                }

                default:
                    return errorResult(`Unknown action: ${action}`);
            }
        },
    };
}
