'use strict';
const fail=()=>{throw Error('Network is forbidden in Project child controlled tests')};
for(const mod of ['http','https'])for(const key of ['request','get'])require('node:'+mod)[key]=fail;
require('node:net').connect=fail;require('node:net').createConnection=fail;require('node:net').Socket.prototype.connect=fail;require('node:net').Server.prototype.listen=fail;
require('node:tls').connect=fail;
for(const key of ['lookup','resolve','resolve4','resolve6'])require('node:dns')[key]=fail;
global.fetch=fail;
