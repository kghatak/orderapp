import axios from 'axios';

// Generate 10 fake device IDs like ESP32-001 to ESP32-010
const deviceIds = Array.from({ length: 10 }, (_, i) => `ESP32-${(i + 1).toString().padStart(3, '0')}`);

// Random number generator
const getRandom = (min, max) => (Math.random() * (max - min) + min).toFixed(3);

// Simulate data for each device
const simulateSensorData = async () => {
  for (const deviceId of deviceIds) {
    const payload = {
      deviceId,
      accel_x: parseFloat(getRandom(-10, 10)),
      accel_y: parseFloat(getRandom(-10, 10)),
      accel_z: parseFloat(getRandom(-10, 10)),
      gyro_x: parseFloat(getRandom(-500, 500)),
      gyro_y: parseFloat(getRandom(-500, 500)),
      gyro_z: parseFloat(getRandom(-500, 500)),
    };

    try {
      const res = await axios.post('http://localhost:5010/sensor/data', payload);
      console.log(`✅ [${deviceId}] → ${res.data}`);
    } catch (error) {
      console.error(`❌ [${deviceId}] → ${error.message || error}`);

      // Retry logic (e.g., retry up to 3 times)
      let retryCount = 0;
      while (retryCount < 3) {
        try {
          const res = await axios.post('http://localhost:5010/sensor/data', payload);
          console.log(`✅ [${deviceId}] → ${res.data}`);
          break;
        } catch (retryError) {
          retryCount++;
          console.error(`❌ [${deviceId}] → Retry ${retryCount}: ${retryError.message || retryError}`);
          if (retryCount === 3) {
            console.error(`❌ [${deviceId}] → Max retries reached, giving up.`);
          }
        }
      }
    }
  }
};

// Repeat every 3 seconds
setInterval(simulateSensorData, 3000);

console.log('🚀 Simulating sensor data for 10 devices every 3s...');
