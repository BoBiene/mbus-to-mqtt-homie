const winston = require('winston');
const schedule = require('node-schedule');
const config = require('config');
const MbusMaster = require('node-mbus');
const { HomieDevice } = require('@chrispyduck/homie-device');

const regexPropertyNameUnit = /^(?<PropertyName>.+?)(\((?<Unit>.+)\))?$/;
const regexFactorUnit = /^(?<Factor>1e-\d)\s+(?<Unit>.+)$/;

const arrayBusAddresses = config.get('mbus.busAddresses');

winston.configure({
    level: 'info',
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
    	winston.format.simple()
    ),
    // defaultMeta: { service: 'mbus-to-mqtt-homie' },
    transports: [
        new winston.transports.Console()
    ]
})

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
    	winston.format.simple()
    ),
    // defaultMeta: { service: 'mbus-to-mqtt-homie' },
    transports: [
        new winston.transports.Console()
    ]
});

var myDevice = new HomieDevice({
    'name': 'mbus-to-mqtt-homie',
    'friendlyName': "MBus to MQTT Homie Bridge",
    'mqtt': config.get('mqtt')
});

var mbusOptions = config.get('mbus');
logger.info(`MBus options: ${JSON.stringify(mbusOptions)}`);

var mbusMaster = new MbusMaster(mbusOptions);
mbusMaster.connect();

arrayBusAddresses.forEach(busAddress => {
    let valueFactors = {};
    let myNode = myDevice.node({ name: 'busAddress-' + busAddress });

    // request for data from devide with ID busAddress
    mbusMaster.getData(busAddress, function (err, data) {
        if (err) {
            logger.error('Error on mbus recieve: ' + err);
        }
        else {
            logger.info('recieved mbus-data: ' + JSON.stringify(data));

            if (data.SlaveInformation) {
                for (let propertyName in data.SlaveInformation) {
                    const propValue = data.SlaveInformation[propertyName];

                    myNode.addProperty({
                        name: 'information/' + propertyName,
                        friendlyName: propertyName,
                        dataType: Number.isInteger(propValue) ? 'integer' : 'string'
                    }).publishValue(propValue);
                }
            }

            if (data.DataRecord) {
                data.DataRecord.forEach(dataRecord => {
                    let match = regexPropertyNameUnit.exec(dataRecord.Unit);
                    let unitGroup = match?.groups["Unit"];
                    let dataType = Number.isInteger(dataRecord.Value) ? 'integer' : 'string';
                    let unit = undefined;

                    if (unitGroup) {
                        let matchFactor = regexFactorUnit.exec(unitGroup);
                        if (matchFactor) {
                            valueFactors[dataRecord.id] = matchFactor.groups['Factor'];
                            unit = matchFactor.groups['Unit'].replace('^2', '²').replace('^3', '³');
                            dataType = 'float';
                        } else {
                            unit = unitGroup;
                        }
                    }

                    myNode.addProperty({
                        name: 'datarecord/id-' + dataRecord.id,
                        friendlyName: match?.groups["PropertyName"] ?? dataRecord.Unit,
                        dataType: dataType,
                        unit: unit
                    }).publishValue((valueFactors[dataRecord.id]) ? valueFactors[dataRecord.id] * dataRecord.Value : dataRecord.Value);
                });
            }
        }

    });

    myDevice.setup();

    schedule.scheduleJob(config.get('publishIntervall'), () => {
        mbusMaster.getData(busAddress, function (err, data) {
            if (err) {
                logger.error('Error on mbus id %d recieve: '+ busAddress, err);
            }
            else {
                logger.debug(`recieved mbus-data (id: ${busAddress}):\n ${JSON.stringify(data, null, 2)}`);

                if (data.SlaveInformation) {
                    for (let propertyName in data.SlaveInformation) {
                        myNode.getProperty('information/' + propertyName)
                            .publishValue(data.SlaveInformation[propertyName]);
                    }
                }
                if (data.DataRecord) {
                    data.DataRecord.forEach(dataRecord => {
                        myNode.getProperty('datarecord/id-' + dataRecord.id)
                            .publishValue((valueFactors[dataRecord.id]) ? valueFactors[dataRecord.id] * dataRecord.Value : dataRecord.Value);
                    });
                }
            }
        });
    });
});

process.on('SIGINT', function () {
    schedule.gracefulShutdown()
        .then(() => {
            mbusMaster.close();
            process.exit(0)
        });
});

