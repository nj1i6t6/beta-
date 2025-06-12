// audio-processor.js

class AudioProcessor extends AudioWorkletProcessor {
  // process 方法會在每次音訊緩衝區滿了之後被呼叫
  process(inputs) {
    // inputs[0][0] 代表第一個輸入源的第一個聲道的 Float32Array 數據
    const inputData = inputs[0][0];
    
    // 如果有音訊數據，就透過 port 傳回主線程
    if (inputData && inputData.length > 0) {
      this.port.postMessage(inputData);
    }
    
    // 返回 true 表示這個處理器應該保持活躍
    return true;
  }
}

// 註冊這個處理器，讓主線程可以透過 'audio-processor' 這個名字找到它
registerProcessor('audio-processor', AudioProcessor);