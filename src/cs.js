function addScript (src) {
  var script = document.createElement('script')
  script.src = chrome.runtime.getURL(src)
  document.head.appendChild(script)
}
function addCss (src, rel, type) {
  var link = document.createElement('link')
  link.rel = rel || 'stylesheet'
  link.type = type || 'text/css'
  link.href = chrome.runtime.getURL(src)
  document.head.appendChild(link)
}
addCss('src/danmu.less', 'stylesheet/less', 'text/css')
addScript('src/douyu_inject.js')
addScript('src/douyuClient.js')
addScript('libs/md5.js')
addScript('libs/JSocket.js')
addScript('libs/less.min.js')

function getSourceURL (rid, cdn = 'ws', rate = '0') {
  const API_KEY = 'A12Svb&%1UUmf@hC'
  const tt = Math.round(new Date().getTime() / 60 / 1000)
  const did = md5(Math.random().toString()).toUpperCase()
  const signContent = [rid, did, API_KEY, tt].join('')
  const sign = md5(signContent)
  let body = {
    'cdn': cdn,
    'rate': rate,
    'ver': '2016102501',
    'tt': tt,
    'did': did,
    'sign': sign
  }
  body = Object.keys(body).map(key => `${key}=${encodeURIComponent(body[key])}`).join('&')
  return fetch(`https://www.douyu.com/lapi/live/getPlay/${rid}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body
  })
  .then(res => res.json())
  .then(videoInfo => {
    const baseUrl = videoInfo.data.rtmp_url
    const livePath = videoInfo.data.rtmp_live
    if (baseUrl && livePath) {
      const videoUrl = `${baseUrl}/${livePath}`
      console.log('RoomId', rid, 'SourceURL:', videoUrl)
      return videoUrl
    } else {
      throw new Error('未开播或获取失败')
    }
  })
}

const getSwfApi = (rid) => {
  const API_KEY = 'bLFlashflowlad92'
  const tt = Math.round(new Date().getTime() / 60 / 1000)
  const signContent = [rid, API_KEY, tt].join('')
  const sign = md5(signContent)
  return fetch(`http://www.douyutv.com/swf_api/room/${rid}?cdn=&nofan=yes&_t=${tt}&sign=${sign}`)
  .then(res => res.json())
  .then(r => r.data)
}
const getACF = key => {
  try {
    return new RegExp(`acf_${key}=(.*?);`).exec(document.cookie)[1]
  } catch (e) {
    return ''
  }
}
const uid = getACF('uid')
const createFlvjs = (videoUrl, onStat) => {
  const sourceConfig = {
    isLive: true,
    type: 'flv',
    url: videoUrl
  }
  const playerConfig = {
    enableWorker: false,
    deferLoadAfterSourceOpen: true,
    stashInitialSize: 512*1024,
    enableStashBuffer: true
  }
  const player = flvjs.createPlayer(sourceConfig, playerConfig)
  player.on(flvjs.Events.ERROR, function(e, t) {
    console.error('播放器发生错误：' + e + ' - ' + t)
    player.unload()
  })
  player.on(flvjs.Events.STATISTICS_INFO, onStat)
  return player
}
flvjs.LoggingControl.forceGlobalTag = true
flvjs.LoggingControl.enableAll = true
const loadVideo = (roomId, replace) => Promise.all([getSourceURL(roomId), getSwfApi(roomId)])
  .then(([videoUrl, swfApi]) => {
    console.log('swfApi', swfApi)
    let player
    let currentCdn = 'ws'
    let currentRate = '0'

    const reload = (url) => {
      player.unload()
      player.detachMediaElement()
      player = createFlvjs(url, onStat)
      player.attachMediaElement(danmuPlayer.video)
      player.load()
      player.play()
      window.player = player
    }
    const onStat = (e) => {
      danmuPlayer.setTip(parseInt(e.speed*10)/10 + 'KB/s')
    }
    const danmuPlayer = new DanmuPlayer(new DanmuPlayerControls({
      onPause: () => player.pause(),
      onPlay: () => player.play(),
      onReload () {
        getSourceURL(roomId, currentCdn, currentRate).then(url => {
          reload(url)
          danmuPlayer.reset()
        })
      },
      onVolume (v = -1) {
        if (v === -1) {
          return player.volume
        } else {
          player.volume = v
        }
      },
      onSendDanmu (txt) {
        // TODO
        window.postMessage({
          type: "SENDANMU",
          data: txt
        }, "*")
      }
    }), pkg => pkg.uid == uid)
    // danmuPlayer.addListener()
    danmuPlayer.parsePic = s => s.replace(/\[emot:dy(.*?)\]/g, (_, i) => `<div style="display:inline-block;background-size:1em;width:1em;height:1em;" class="face_${i}"></div>`)
    replace(danmuPlayer.el)

    const cdnMenu = () => swfApi.cdnsWithName.map(i => {
      let suffix = ''
      if (i.cdn == currentCdn) suffix = ' √'
      return {
        text: i.name + suffix,
        cb () {
          currentCdn = i.cdn
          getSourceURL(roomId, i.cdn, currentRate).then(url => {
            reload(url)
            danmuPlayer.reset()
          })
        }
      }
    })
    const rateMenu = () => {
      const rates = [{
        text: '超清',
        rate: '0'
      }, {
        text: '高清',
        rate: '2'
      }, {
        text: '普清', 
        rate: '1'
      }]
      return rates.map(i => {
        let suffix = ''
        if (i.rate == currentRate) suffix = ' √'
        return {
          text: i.text + suffix,
          cb () {
            currentRate = i.rate
            getSourceURL(roomId, currentCdn, i.rate).then(url => {
              reload(url)
              danmuPlayer.reset()
            })
          }
        }
      })
    }
    bindMenu(danmuPlayer.video, () => [].concat(cdnMenu(), rateMenu()))

    player = createFlvjs(videoUrl, onStat) // flvjs.createPlayer(sourceConfig, playerConfig)
    player.attachMediaElement(danmuPlayer.video)

    danmuPlayer.initControls()

    player.load()
    player.play()
    window.player = player
    window.danmu = danmuPlayer
    return danmuPlayer
  })
const getRoomId = () => {
  let rid
  try {
    return /rid=(\d+)/.exec(document.querySelector('.feedback-report-button').href)[1]
  } catch (e) {}
  try {
    rid = document.querySelector('.current').getAttribute('data-room_id')
    if (rid) {
      return rid
    }
  } catch (e) {}
  try {
    rid = /"room_id":(\d+)/.exec(document.head.innerHTML)[1]
    if (rid !== '0') {
      return rid
    }
  } catch (e) {}
  throw new Error('未找到RoomId')
}

loadVideo(getRoomId(), newPlayer => {
  let roomVideo = document.querySelector('#js-room-video')
  if (!roomVideo) {
    roomVideo = document.querySelector('.live_site_player_container')
  }

  roomVideo.removeChild(roomVideo.children[0])
  roomVideo.insertBefore(newPlayer, roomVideo.children[0])
}).then(danmuPlayer => {
  window.addEventListener('message', event => {
    if (event.source != window)
      return

    if (event.data.type && (event.data.type == "DANMU")) {
      const data = event.data.data
      danmuPlayer.onDanmu(data)
    }
  }, false)
})
