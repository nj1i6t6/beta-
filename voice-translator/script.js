// script.js (真正最終版)

import { GoogleGenAI, Modality } from "https://esm.run/@google/genai";

// --- DOM 元素選擇 ---
const leftLangSelect = document.getElementById('left-lang');
const rightLangSelect = document.getElementById('right-lang');
const leftBtn = document.getElementById('left-btn');
const rightBtn = document.getElementById('right-btn');
const leftResultBox = document.getElementById('left-result');
const rightResultBox = document.getElementById('right-result');
const statusText = document.getElementById('status-text');
const allButtons = [leftBtn, rightBtn];

// --- API 金鑰 ---
const API_KEY = 'AIzaSyC2l7mrzCMYcZ33pAOldgVbBiCxGvBuizc'; // 請務必替換成您自己的 API 金鑰

// --- 全域狀態變數 ---
let session;
let audioContext;
let microphoneStream;
let audioWorkletNode;
let isSessionActive = false;
let audioQueue = [];
let isPlaying = false;

const TARGET_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// --- 初始化 ---
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("你的瀏覽器不支援麥克風存取！");
}

// --- 事件監聽 ---
allButtons.forEach(btn => {
    btn.addEventListener('click', () => toggleTranslationSession(btn));
});


/**
 * 開始或停止翻譯會話
 */
async function toggleTranslationSession(clickedBtn) {
    if (isSessionActive) {
        await stopSession();
        return;
    }

    if (API_KEY === 'YOUR_API_KEY') {
        alert("請先在 script.js 中填入你的 Gemini API 金鑰！");
        return;
    }

    isSessionActive = true;
    const sourceSide = clickedBtn.dataset.source;
    const targetSide = clickedBtn.dataset.target;
    const sourceLangSelect = document.getElementById(`${sourceSide}-lang`);
    const targetLangSelect = document.getElementById(`${targetSide}-lang`);
    const sourceLangText = sourceLangSelect.options[sourceLangSelect.selectedIndex].text;
    const targetLangText = targetLangSelect.options[targetLangSelect.selectedIndex].text;
    const sourceResultBox = document.getElementById(`${sourceSide}-result`);
    const targetResultBox = document.getElementById(`${targetSide}-result`);
    sourceResultBox.textContent = '';
    targetResultBox.textContent = '';
    clickedBtn.classList.add('active-session');
    clickedBtn.textContent = "停止翻譯";
    allButtons.forEach(b => { if (b !== clickedBtn) b.disabled = true; });
    statusText.textContent = "正在請求麥克風權限...";

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        await audioContext.audioWorklet.addModule('audio-processor.js');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        microphoneStream = stream;
        const sourceNode = audioContext.createMediaStreamSource(stream);
        
        audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');
        sourceNode.connect(audioWorkletNode);

        statusText.textContent = "正在連線至 Gemini Live API...";
        const genAI = new GoogleGenAI({ apiKey: API_KEY });
        
        session = await genAI.live.connect({
            model: "gemini-2.5-flash-preview-native-audio-dialog",
            // 【核心修正】遵守 API 規定，修正 config 物件
            config: {
                // 1. responseModalities 只能有一種，我們選擇 AUDIO
                responseModalities: [Modality.AUDIO],
                // 2. 透過 outputAudioTranscription 來要求翻譯後音訊的文字稿
                outputAudioTranscription: {},
                // 系統指令和輸入轉錄保持不變
                systemInstruction: `You are a real-time translator. The user will speak in ${sourceLangText}, and you must respond with the translated text and audio in ${targetLangText}. Do not add any extra explanations.`,
                inputAudioTranscription: {},
            },
            callbacks: {
                onopen: () => {
                    statusText.textContent = `連線成功！請開始說話 (${sourceLangText}) ...`;
                },
                onmessage: (message) => {
                    handleLiveMessage(message, sourceResultBox, targetResultBox);
                },
                onerror: (error) => {
                    console.error("Live API 錯誤:", error);
                    statusText.textContent = `連線錯誤: ${error.message}`;
                    stopSession();
                },
                onclose: () => {
                    stopSession();
                },
            },
        });

        audioWorkletNode.port.onmessage = (event) => {
            if (!isSessionActive || !session) return;
            const inputData = event.data;
            const downsampledData = downsampleBuffer(inputData, audioContext.sampleRate, TARGET_SAMPLE_RATE);
            const pcm16Data = convertFloat32ToInt16(downsampledData);
            const audioBase64 = int16ArrayToBase64(pcm16Data);
            
            try {
                session.sendRealtimeInput({
                    audio: { data: audioBase64, mimeType: `audio/pcm;rate=${TARGET_SAMPLE_RATE}` }
                });
            } catch (error) {
                console.warn("無法發送音訊數據，連線可能已關閉。", error.message);
            }
        };

    } catch (error) {
        console.error("Error during session startup:", error);
        statusText.textContent = `錯誤: ${error.message}`;
        await stopSession();
    }
}

/**
 * 處理來自 Live API 的即時訊息
 */
function handleLiveMessage(message, sourceResultBox, targetResultBox) {
    // 處理輸入語音的轉錄文字
    if (message.serverContent?.inputTranscription?.text) {
        sourceResultBox.textContent = message.serverContent.inputTranscription.text;
    }

    // 【核心修正】從 outputTranscription 獲取翻譯後的文字
    if (message.serverContent?.outputTranscription?.text) {
        targetResultBox.textContent = message.serverContent.outputTranscription.text;
    }
    
    // 處理翻譯後的音訊 (這部分不變)
    if (message.data) {
        const pcm16Data = base64ToInt16Array(message.data);
        const float32Data = convertInt16ToFloat32(pcm16Data);
        audioQueue.push(float32Data);
        if (!isPlaying) {
            playNextAudioChunk();
        }
    }
    
    if(message.serverContent?.turnComplete) {
         statusText.textContent = "翻譯完成！您可以繼續說話...";
    }
}

function playNextAudioChunk() {
    if (audioQueue.length === 0) { isPlaying = false; return; }
    isPlaying = true;
    const audioData = audioQueue.shift();
    if (!audioContext || audioContext.state === 'closed') { isPlaying = false; return; }
    const audioBuffer = audioContext.createBuffer(1, audioData.length, OUTPUT_SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(audioData);
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start();
    source.onended = playNextAudioChunk;
}


/**
 * 停止會話並清理資源
 */
async function stopSession() {
    if (!isSessionActive) {
        return;
    }
    isSessionActive = false;
    statusText.textContent = "正在停止連線...";
    if (session) {
        try { session.close(); } catch (e) { console.warn("嘗試關閉一個可能已關閉的 session:", e.message); }
        session = null;
    }
    if (microphoneStream) {
        microphoneStream.getTracks().forEach(track => track.stop());
        microphoneStream = null;
    }
    if (audioWorkletNode) {
        audioWorkletNode.port.onmessage = null;
        audioWorkletNode.disconnect();
        audioWorkletNode = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
        await audioContext.close().catch(e => console.error("關閉 AudioContext 時出錯:", e));
        audioContext = null;
    }
    isPlaying = false;
    audioQueue = [];
    allButtons.forEach(b => {
        b.classList.remove('active-session');
        b.textContent = "開始翻譯";
        b.disabled = false;
    });
    statusText.textContent = "連線已中斷。請重新開始。";
}


// --- 音訊處理輔助函式 --- (這部分不變)
function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
    if (inputSampleRate === outputSampleRate) return buffer;
    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[offsetResult] = accum / (count || 1);
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return result;
}
function convertFloat32ToInt16(buffer) {
    let l = buffer.length;
    const buf = new Int16Array(l);
    while (l--) {
        buf[l] = Math.min(1, buffer[l]) * 0x7FFF;
    }
    return buf;
}
function int16ArrayToBase64(buf) {
    const uint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    return btoa(String.fromCharCode.apply(null, uint8));
}
function base64ToInt16Array(base64) {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
}
function convertInt16ToFloat32(buffer) {
    let l = buffer.length;
    const output = new Float32Array(l);
    while (l--) {
        output[l] = buffer[l] / 0x7FFF;
    }
    return output;
}
