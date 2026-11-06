import { existsSync } from 'node:fs';
import { join } from 'node:path';
export class RoutedVoice {
    options;
    constructor(options) {
        this.options = options;
    }
    async speak(text, voice = 'zh-CN-XiaoxiaoNeural', play = true) {
        const local = this.isCloned(voice);
        if (!local && this.options.volcTts) {
            const message = await this.options.volcTts.speak(text, voice);
            if (play) {
                await this.options.pythonVoice.playLocal(message.audioPath);
            }
            return message;
        }
        return this.options.pythonVoice.speak(text, voice, play);
    }
    createVoice(samplePath, name = 'mine') {
        return this.options.pythonVoice.createVoice(samplePath, name);
    }
    listen(audioPath) {
        return this.options.pythonVoice.listen(audioPath);
    }
    listenPhone(durationMs, adbPath, deviceSerial) {
        return this.options.pythonVoice.listenPhone(durationMs, adbPath, deviceSerial);
    }
    isCloned(voice) {
        return existsSync(join(this.options.voicesDir, voice, 'voice.json'));
    }
}
