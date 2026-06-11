const fs = require('fs');
const data = JSON.parse(fs.readFileSync('api-1.json'));
const schema = data.components.schemas['CreateUserRequestDto'];
console.log(JSON.stringify(schema, null, 2));
