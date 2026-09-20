import _makeWASocket from './Socket/index.js';
import { printChamaBanner } from './Caller/banner.js';
import { enableCallAutoAnswer, getActiveVoipClient } from './Caller/auto-answer.js';

export * from '../WAProto/index.js';
export * from './Utils/index.js';
export * from './Types/index.js';
export * from './Defaults/index.js';
export * from './WABinary/index.js';
export * from './WAM/index.js';
export * from './WAUSync/index.js';
export { printChamaBanner, enableCallAutoAnswer, getActiveVoipClient };

const makeWASocket = (config = {}) => {
    const sock = _makeWASocket(config);

    // Convenience method on socket instance
    sock.enableCallAutoAnswer = (opts) => enableCallAutoAnswer(sock, opts);

    let bannerShown = false;
    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;
        if (connection === 'open') {
            if (!bannerShown) {
                printChamaBanner(sock.user?.id || sock.user?.name || "Connected");
                bannerShown = true;
            }
            if (config.callConfig) {
                try {
                    await enableCallAutoAnswer(sock, config.callConfig);
                } catch (err) {
                    console.error('❌ [Chama Caller] Failed to auto-initialize call engine:', err);
                }
            }
        }
    });

    return sock;
};

export { makeWASocket };
export default makeWASocket;