import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Point } from '@influxdata/influxdb-client';
import { writeApi } from '../util/influxdb.js';

const router = express.Router();

// Resolve __dirname (ESM-compatible)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataFilePath = path.join(__dirname, '..', 'sensorData.json');

// Ensure file exists
if (!fs.existsSync(dataFilePath)) {
    fs.writeFileSync(dataFilePath, JSON.stringify([], null, 2));
}

// Save to local JSON file (optional fallback)
const saveToFile = async (entry) => {
    try {
        const fileData = fs.existsSync(dataFilePath)
            ? JSON.parse(fs.readFileSync(dataFilePath, 'utf8'))
            : [];

        fileData.push(entry);

        fs.writeFileSync(dataFilePath, JSON.stringify(fileData, null, 2));
        console.log('💾 Data saved locally');
    } catch (error) {
        console.error('❌ Error writing to local file:', error);
    }
};

// POST: Receive sensor data
router.post('/data', async (req, res) => {
    const data = req.body;
    console.log('📥 Incoming data:', data);

    const entry = {
        timestamp: new Date().toISOString(),
        ...data,
        deviceId: data.deviceId || 'unknown',
    };

    try {
        // Create InfluxDB Point
        const point = new Point('sensor_data')
            .tag('deviceId', entry.deviceId)
            .floatField('accel_x', entry.accel_x)
            .floatField('accel_y', entry.accel_y)
            .floatField('accel_z', entry.accel_z)
            .floatField('gyro_x', entry.gyro_x)
            .floatField('gyro_y', entry.gyro_y)
            .floatField('gyro_z', entry.gyro_z)
            .timestamp(new Date());

        // Write to InfluxDB
        writeApi.writePoint(point);
        await writeApi.flush();

        // Optional backup to local file
        await saveToFile(entry);

        console.log('✅ Data written to InfluxDB');
        res.status(200).send('Data received and saved!');
    } catch (err) {
        console.error('❌ Error while writing to InfluxDB:', err);
        res.status(500).send('Error saving data');
    }
});

// GET: View local data (for testing/debugging)
router.get('/data', (req, res) => {
    try {
        const data = fs.readFileSync(dataFilePath, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        console.error('❌ Error reading local data:', error);
        res.status(500).send('Failed to read sensor data');
    }
});

export default router;
