import { spawn } from 'child_process';
import http from 'http';

const startServerAndFetch = async () => {
  console.log("Starting dev server...");
  const devProcess = spawn('npm', ['run', 'dev'], { stdio: 'pipe' });
  
  // Wait for server to be ready
  await new Promise((resolve) => setTimeout(resolve, 8000));
  
  console.log("Fetching /api/nonexistent...");
  http.get('http://localhost:3000/api/nonexistent', (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log(`BODY (first 500 chars):\n${data.substring(0, 500)}`);
      devProcess.kill();
      process.exit(0);
    });
  }).on('error', (err) => {
    console.error("HTTP Error: ", err);
    devProcess.kill();
    process.exit(1);
  });
};

startServerAndFetch();
