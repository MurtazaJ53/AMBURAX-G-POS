const net = require('net');
const client = new net.Socket();
client.connect(55432, '127.0.0.1', () => {
    console.log('Connected');
    client.destroy();
});
client.on('error', () => {
    console.log('Failed');
});
