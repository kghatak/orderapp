let isRunning = true;

process.on('message', (data) => {
  if (data.command === 'stop-processing') {
    isRunning = false;
    process.send({ status: 'stopped' });
    process.exit(0);
  } else {
        startProcessing(data);
  }
});

function startProcessing(initialData) {
  setInterval(async () => {
    if (!isRunning) return;

    
    // Perform your batch processing here
    await processStudentData(initialData);

        process.send({ status: 'completed' });

    // Continue processing if still running
    if (isRunning) {
      process.send({ status: 'ready' });
    }
  }, 1000); // Wait for 1 second before processing again
}

async function processStudentData(data) {
  // Simulate a long-running task
  return new Promise((resolve) => {
    setTimeout(() => {
            resolve();
    }, 5000); // Simulate a 5-second processing time
  });
}