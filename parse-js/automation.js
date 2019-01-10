var Parse = require('parse/node');
var mqtt = require('mqtt')
var client  = mqtt.connect('mqtt://115.159.98.171:1883')

const UserInfo = Parse.Object.extend("UserInfo");

Parse.initialize("r5em6wDjRffPNR6900ll9leu0T1sZP8t2TCZbPrI", "sLj9Qhu8Lj3ea21kxpMBHNaRGUqSjJqXPE3dDtBH");

Parse.serverURL = 'http://47.101.66.229:1337/parse';

const UserAutomation = Parse.Object.extend("UserAutomation");
var automationList = []
const query = new Parse.Query(UserAutomation)

const p = new Parse.Query('UserAutomation')
const subscription = p.subscribe();

subscription.on('open', () => {
    console.log('subscription opened');
});

subscription.on("error", (all)=>{
    console.log("subscription error")
})

subscription.on("create", (object)=> {
    console.log("[subscription:onCreate] topic:"+object.get("sourceTopic") + "condition: "+object.get("condition"))
    client.end()
    client.reconnect()
})

subscription.on('delete', (object) => {
    console.log("[subscription:onDelete] topic:"+object.get("sourceTopic") + "condition: "+object.get("condition"))
    client.end()
    client.reconnect()
});

client.on("connect", ()=>{
    query.find().then((objects)=>{
        for(var i = 0; i < objects.length; i++){
            var sourceTopic = objects[i].get('sourceTopic');
            var condition = objects[i].get('condition');
            var type = objects[i].get('type');
            var targetTopic = objects[i].get('targetTopic');
            var operation = objects[i].get('operation');
            var automation = {
                type,
                sourceTopic,
                condition,
                targetTopic,
                operation,
                done: false
            }
            automationList.push(automation);
        }
        queryCallBack()
    })
})


function queryCallBack(){
    for(var i = 0; i < automationList.length; i++){
        let a = automationList[i];
        client.subscribe(a.sourceTopic, (error) => {
            if(error == null){
                console.log("[client sub] "+a.sourceTopic+" successfully");
            }
        });
    }
}

function isTopicInUse(topic){
    for(let i = 0; i < automationList.length; i++){
        if(automationList[i].sourceTopic === topic)
            return i;
    }
    return null;
}

client.on("message", (topic, msg) =>{
    let inUse =  isTopicInUse(topic);
    let automationItem = automationList[inUse];
    var msg = JSON.parse(msg);
    
    if(automationItem){
        console.log(msg)
        let condition = eval(msg['humidity']+automationItem.condition);
        if(condition){
            if(automationItem.type==="info"){
                if(!automationItem.done){
                    automationItem.done = true;
                    d = new Date();
                    content = "设备在"+(d.getMonth()+1)+"月"+d.getDate()+"日"+d.getHours()+"时"+d.getMinutes()+
                                "分达到设定阈值"+ automationItem.condition.slice(1);
                    userInfo = new UserInfo();
                    userInfo.set("info", content);
                    userInfo.set("isPush", true)
                    userInfo.save().then((data) => {
                        console.log("[parse:save] "+data.id)
                    }, (error) => {
                        console.log("[parse:save] "+ error)
                    })
                    client.publish("push",'{"title":"用户自定义通知", "content":'+ content+'}')                    
                }
            }else if(automationItem.type === "operation"){
                if(!automationItem.done){
                    client.publish(automationItem.targetTopic, automationItem.operation)
                }
            }
        }else{
            automationItem.done = false;
        }
    }
})


