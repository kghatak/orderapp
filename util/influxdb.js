import { InfluxDB } from '@influxdata/influxdb-client';

// InfluxDB configuration
const url = 'https://us-east-1-1.aws.cloud2.influxdata.com';
const token = 'jCL3q70ROp6AML7tk9o-iYGU7vIhLdZEGDMI-uc5_YXaShP_m7rnzrA5BzOg5Ig4H_a5REBsAWBoZMVaPsGNmA==';
const org = 'indiaiothub';
const bucket = 'movements';

// Initialize InfluxDB client
export const client = new InfluxDB({ url, token });

// Create Write API with nanosecond precision
export const writeApi = client.getWriteApi(org, bucket, 'ns');

// Default tag for all points
writeApi.useDefaultTags({ location: 'ESP32' });
