const winston = require('winston');
const schedule = require('node-schedule');
const config = require('config');
const MbusMaster = require('node-mbus');
const { HomieDevice } = require('@chrispyduck/homie-device');

const regexPropertyNameUnit = /^(?<PropertyName>.+?)(\((?<Unit>.+)\))?$/;
const regexFactorUnit = /^(?<Factor>1e-\d)\s+(?<Unit>.+)$/;

const arrayBusAddresses = config.get('mbus.busAddresses');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'user-service' },
    transports: [
        new winston.transports.Console(),
        //
        // - Write all logs with importance level of `error` or less to `error.log`
        // - Write all logs with importance level of `info` or less to `combined.log`
        //
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
    ],
});

//
// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
//
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple(),
    }));
}


var myDevice = new HomieDevice({
    'name': 'mbus-to-mqtt-homie',
    'friendlyName': "MBus to MQTT Homie Bridge",
    'mqtt': config.get('mqtt')
});

var mbusOptions = config.get('mbus');
logger.info("MBus options: %o", JSON.stringify(mbusOptions, null, 2));

var mbusMaster = new MbusMaster(mbusOptions);
mbusMaster.connect();

arrayBusAddresses.forEach(busAddress => {
    let valueFactors = {};
    let myNode = myDevice.node({ name: 'busAddress-' + busAddress });

    // request for data from devide with ID busAddress
    mbusMaster.getData(busAddress, function (err, data) {
        if (err) {
            logger.error('Error on mbus recieve: %o', err);
        }
        else {
            logger.info('recieved mbus-data:\n%s', JSON.stringify(data, null, 2));

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
                logger.error('Error on mbus id %d recieve: %o', busAddress, err);
            }
            else {
                logger.debug('recieved mbus-data (id: %d):\n%s', busAddress, JSON.stringify(data, null, 2));

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

