import { providers, Wallet, Contract } from 'ethers';

let contracts = {};
let provider;
let signer;
let builtinProvider;

var eth = {
    _setup: (web3ProviderOrURL, web3Provider, privateKey, fallbackURL) => { // TODO rename web3Provider/web3ProviderOrURL to web3Provider/...
        let web3ProviderGiven;
        contracts = {};
        provider = undefined;
        signer = undefined;
        builtinProvider = undefined;
        if (typeof web3ProviderOrURL === 'string') {
            provider = new providers.JsonRpcProvider(web3ProviderOrURL);
            if (privateKey) {
                signer = new Wallet(privateKey);
                signer = signer.connect(provider);
                builtinProvider = provider;
            } else if (web3Provider) {
                builtinProvider = new providers.Web3Provider(web3Provider);
                web3ProviderGiven = web3Provider;
            } else {
                builtinProvider = provider;
            }
        } else {
            provider = new providers.Web3Provider(web3ProviderOrURL);
            web3ProviderGiven = web3ProviderOrURL;
            builtinProvider = provider;
            signer = provider.getSigner();
        }

        // TODO remove (debug)
        if (typeof window !== 'undefined') {
            window.provider = provider;
            window.signer = signer;
            window.builtinProvider = builtinProvider;
            window.web3Provider = web3ProviderGiven;
        }

        return {
            provider,
            signer,
            builtinProvider,
            web3Provider: web3ProviderGiven,
            fallbackProvider: fallbackURL ? new providers.JsonRpcProvider(fallbackURL) : undefined,
        };
    },
    fetchChainId: () => {
        return provider.send('net_version').then((result) => {
            return '' + result;
        });
        // return provider.getNetwork().then((net) => {
        //     const chainId = '' + net.chainId;
        //     if (chainId == '1337') { // detect ganache
        //         return provider.send('net_version').then((result) => {
        //             return '' + result;
        //         });
        //     } else {
        //         return chainId;
        //     }
        // });
    },
    fetchBuiltinChainId: () => {
        return builtinProvider.send('net_version').then((result) => {
            return '' + result;
        });
        // return builtinProvider.getNetwork().then((net) => {
        //     const chainId = '' + net.chainId;
        //     if (chainId == '1337') { // detect ganache
        //         return builtinProvider.send('net_version').then((result) => {
        //             return '' + result;
        //         });
        //     } else {
        //         return chainId;
        //     }
        // });
    },
    fetchAccounts: () => builtinProvider.listAccounts(),
    setupContracts: (contractsInfo) => {
        contracts = {};
        for (let key of Object.keys(contractsInfo)) {
            const info = contractsInfo[key];
            contracts[key] = new Contract(info.address, info.contractInfo.abi, signer || provider);
        }

        // TODO remove (debug)
        window.contracts = contracts;

        return contracts;
    },
    getTransactionReceipt: async (txHash) => {
        let p = await provider.getTransactionReceipt(txHash);
        return p;
    },
    getBalance: async (addressOrName) => {
        let p = await provider.getBalance(addressOrName);
        return p;
    },

};

async function chrome76Detection() {
	if ('storage' in navigator && 'estimate' in navigator.storage) {
		const {usage, quota} = await navigator.storage.estimate();
		if(quota < 120000000)
			return true;
		else
			return false;
	} else {
		return false;
	}
}

function isNewChrome () {
    const pieces = navigator.userAgent.match(/Chrom(?:e|ium)\/([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)/);
    if (pieces == null || pieces.length != 5) {
        return undefined;
    }
    major = pieces.map(piece => parseInt(piece, 10))[1];
	if(major >= 76) {
        return true
    }
	return false;
}

/// from https://github.com/jLynx/PrivateWindowCheck (see https://stackoverflow.com/questions/2860879/detecting-if-a-browser-is-using-private-browsing-mode/55231766#55231766)
function isPrivateWindow() {
    return new Promise(function (resolve, reject) {
        if (typeof window === 'undefined') {
            resolve(false);
            return;
        }
        try {
            const isSafari = navigator.vendor && navigator.vendor.indexOf('Apple') > -1 &&
                   navigator.userAgent &&
                   navigator.userAgent.indexOf('CriOS') == -1 &&
                   navigator.userAgent.indexOf('FxiOS') == -1;
                     
            if(isSafari){
                //Safari
                let  e = false;
                if (window.safariIncognito) {
                    e = true;
                } else {
                    try {
                        window.openDatabase(null, null, null, null);
                        window.localStorage.setItem("test", 1);
                        resolve(false);
                    } catch (t) {
                        e = true;
                        resolve(true); 
                    }
                    void !e && (e = !1, window.localStorage.removeItem("test"));
                }
            } else if(navigator.userAgent.includes("Firefox")){
                //Firefox
                var db = indexedDB.open("test");
                db.onerror = function(){resolve(true);};
                db.onsuccess =function(){resolve(false);};
            } else if(navigator.userAgent.includes("Edge") || navigator.userAgent.includes("Trident") || navigator.userAgent.includes("msie")){
                //Edge or IE
                if(!window.indexedDB && (window.PointerEvent || window.MSPointerEvent))
                    resolve(true);
                resolve(false);
            } else {	//Normally ORP or Chrome
                //Other
                if(isNewChrome())
                    resolve(chrome76Detection());
    
                const fs = window.RequestFileSystem || window.webkitRequestFileSystem;
                if (!fs) resolve(null);
                else {
                    fs(window.TEMPORARY, 100, function(fs) {
                        resolve(false);
                    }, function(err) {
                        resolve(true);
                    });
                }
            }
        }
        catch(err) {
            console.error(err);
            resolve(null);
        }
    });
}

function noop() {}
function safe_not_equal(a, b) {
	return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
const subscriber_queue = [];
function writable(value, start) {
    if (!start) { start = noop; }
	let stop;
	const subscribers = [];

	function set(new_value) {
		if (safe_not_equal(value, new_value)) {
			value = new_value;
			if (stop) { // store is ready
				const run_queue = !subscriber_queue.length;
				for (let i = 0; i < subscribers.length; i += 1) {
					const s = subscribers[i];
					s[1]();
					subscriber_queue.push(s, value);
				}
				if (run_queue) {
					for (let i = 0; i < subscriber_queue.length; i += 2) {
						subscriber_queue[i][0](subscriber_queue[i + 1]);
					}
					subscriber_queue.length = 0;
				}
			}
		}
	}

	function update(fn){
		set(fn(value));
	}

	function subscribe(run, invalidate) {
        if (!invalidate) { invalidate = noop; }
		const subscriber = [run, invalidate];
		subscribers.push(subscriber);
		if (subscribers.length === 1) {
			stop = start(set) || noop;
		}
		run(value);

		return () => {
			const index = subscribers.indexOf(subscriber);
			if (index !== -1) {
				subscribers.splice(index, 1);
			}
			if (subscribers.length === 0) {
				stop();
				stop = null;
			}
		};
	}

	return { set, update, subscribe };
}

// TODO add timeout for settinpu Wallet // getting accounts, etc...
// TODO deal with error and error recovery
// error as notification, revert to previous state

const voidLog = {
    trace:() => {},
    debug:() => {},
    info:() => {},
    warn:() => {},
    error:() => {},
    fatal:() => {},
    silent:() => {},
};

function getWalletVendor(ethereum) {
    if (!ethereum) {
        return undefined;
    } else if(ethereum.isMetaMask) {
        return 'Metamask';
    } else if(navigator.userAgent.indexOf("Opera") != -1 || navigator.userAgent.indexOf("OPR/") != -1) {
        return 'Opera';
    } else {
        return 'unknown';
    }
    // TODO
}


const $wallet = {
    status: 'Loading',
    requestingTx: false, // TODO rename waitingTxConfirmation or add steps // number of block confirmation, etc...
};
if (typeof window !== 'undefined') {
    window.$wallet = $wallet;
}
var index = (log) => {
    if(!log) {
        log = voidLog;
    }

    let metamaskFirstLoadIssue;
    let _ethSetup;
    let _fallbackUrl;
    let _registerContracts;
    let _fetchInitialBalance;
    let _supportedChainIds;
    const _registeredWalletTypes = {};
    let _ethereum;
    let _onlyLocal;
    let _onlyBuiltin;
    
    function reloadPage(reason, instant) {
        if (typeof window !== 'undefined') {
            log.info((instant ? 'instant ' : '') + 'reloading page because ' + reason);
            if (instant) {
                window.location.reload();
            } else {
                setTimeout(() => window.location.reload(), 100);
            }
        }
    }

    const { subscribe, set, update } = writable();
    let contracts = {};
    function _set(obj) {
        for (let key of Object.keys(obj)) {
            $wallet[key] = obj[key];
        }
        log.info('WALLET', JSON.stringify($wallet, null, '  '));
        set($wallet);
    }

    _set($wallet);

    function getEthereum() {
        if (typeof window !== 'undefined') {
            if (window.ethereum) {
                return window.ethereum;
            } else if (window.web3) {
                return window.web3.currentProvider;
            }
        }
        return null;
    }

    function fetchEthereum() {
        // TODO test with document.readyState !== 'complete' || document.readyState === 'interactive'
        return new Promise((resolve, reject) => {
            if(document.readyState !== 'complete') {
                document.onreadystatechange = function() {
                    if (document.readyState === 'complete') {
                        document.onreadystatechange = null;
                        resolve(getEthereum());    
                    }
                };
            } else {
                resolve(getEthereum());
            }
        });
    }

    function watch(web3Provider) {
        async function checkAccounts(accounts) {
            if ($wallet.status === 'Locked' || $wallet.status === 'Unlocking') { // TODO SettingUpWallet ?
                return; // skip as Unlock / post-Unlocking will fetch the account
            }
            // log.info('checking ' + accounts);
            if (accounts && accounts.length > 0) {
                const account = accounts[0];
                if ($wallet.address) {
                    if (account.toLowerCase() !== $wallet.address.toLowerCase()) {
                        reloadPage('accountsChanged', true);
                    }
                } else {
                    // if($wallet.readOnly) { // TODO check if it can reach there ?
                    //     _ethSetup = eth._setup(web3Provider, undefined, undefined, _fallbackUrl);
                    // }
                    let initialBalance;
                    if(_fetchInitialBalance) {
                        initialBalance = await _ethSetup.provider.getBalance(account);
                    }
                    log.info('now READY');
                    _set({
                        address: account,
                        status: 'Ready',
                        readOnly: undefined,
                        initialBalance,
                    });
                }
            } else {
                if ($wallet.address) {
                    // if($wallet.readOnly) {  // TODO check if it can reach there ?
                    //     _ethSetup = eth._setup(web3Provider, undefined, undefined, _fallbackUrl);
                    // }
                    _set({
                        address: undefined,
                        status: 'Locked',
                        readOnly: undefined,
                    });
                }
            }
        }
        function checkChain(newChainId) {
            // log.info('checking new chain ' + newChainId);
            if ($wallet.chainId && newChainId != $wallet.chainId) {
                log.info('from ' + $wallet.chainId + ' to ' + newChainId);
                reloadPage('networkChanged');
            }
        }
        async function watchAccounts() {
            if ($wallet.status === 'WalletToChoose' || $wallet.status === 'Locked' || $wallet.status === 'Unlocking') {
                return; // skip as Unlock / post-Unlocking will fetch the account
            }
            let accounts;
            try {
                // log.trace('watching accounts...');
                accounts = await eth.fetchAccounts();
                // log.trace(`accounts : ${accounts}`);
            } catch (e) {
                log.error('watch account error', e);
            }

            await checkAccounts(accounts);
        }
        async function watchChain() {
            let newChainId;
            try {
                // log.trace('watching chainId...');
                newChainId = await eth.fetchBuiltinChainId();
                // log.trace(`newChainId : ${newChainId}`);
            } catch (e) {
                log.error('watch account error', e);
            }

            checkChain(newChainId);
        }

        if (web3Provider) { // TODO only if builtin is chosen // can use onNetworkChanged / onChainChanged / onAccountChanged events for specific web3 provuder setup
            try {
                web3Provider.once('accountsChanged', checkAccounts);
                web3Provider.once('networkChanged', checkChain);
                web3Provider.once('chainChanged', checkChain);
            } catch (e) {
                log.info('no web3Provider.once');
            }
        }

        // TODO move that into the catch block except for Metamask

        // still need to watch as even metamask do not emit the "accountsChanged" event all the time: TODO report bug
        setInterval(watchAccounts, 1000);

        // still need to watch chain for old wallets
        setInterval(watchChain, 2000);
    }

    async function retry() {
        if (_retry) {
            if(metamaskFirstLoadIssue) {
                reloadPage('metamask issue', true);
            } else {
                return _retry(true);    
            }
        } else {
            throw new Error('cannot retry');
        }
    }

    function withTimeout(ms, promise) {
        let timeoutPromise = new Promise((resolve, reject) => {
            let id = setTimeout(() => {
              clearTimeout(id);
              reject({message: 'Timed out in '+ ms + 'ms.', type: 'timeout'});
            }, ms);
        });
        return Promise.race([
            promise,
            timeoutPromise
        ])
    }

    function fetchChainIdWithTimeout(eth, ms = 2000) {
        let timeout = new Promise((resolve, reject) => { // TODO use `withTimeout(...)`
            let id = setTimeout(() => {
              clearTimeout(id);
              reject('Timed out in '+ ms + 'ms.');
            }, ms);
        });
        return Promise.race([
            eth.fetchChainId(),
            timeout
        ])
    }

    function _recordUse(walletTypeId) {
        _set({
            walletChosen: walletTypeId,
        });
        try {
            localStorage.setItem('__last_wallet_used', walletTypeId);
        } catch(e){}
    }

    async function _useBuiltinWallet(ethereum, unlock, isRetry) {
        if (!ethereum) {
            throw new Error('no ethereum provided');
        }
        _recordUse('builtin');
        
        let opera_enabled_before = false;
        const isOperaWallet = $wallet.builtinWalletPresent === 'Opera';
        if (isOperaWallet) {
            opera_enabled_before = localStorage.getItem('opera_wallet_enabled');
            if (!opera_enabled_before && !isRetry) {
                _set({
                    status: 'Opera_Locked', // TODO use Locked but mention it is not readable ?
                });
                return $wallet;
            }
        }
        
        _ethSetup = eth._setup(ethereum, undefined, undefined, _fallbackUrl);
        // log.info('web3 is there...');
        // log.info('checking chainId...');
        let chainId;
        try {
            log.trace('fetching chainId...');
            chainId = await fetchChainIdWithTimeout(eth);
            log.trace(`chainId : ${chainId}`);
        } catch (e) {
            if(typeof e === 'string' && e.startsWith('Timed out')) {
                metamaskFirstLoadIssue = true;
            }
            log.error('builtin wallet : error fetching chainId', e);
            if(_fallbackUrl) {
                _ethSetup = eth._setup(_fallbackUrl, ethereum, undefined, _fallbackUrl);
            }
            if (isOperaWallet) {
                log.info('Opera web3 quircks');
                // if (isRetry) {
                //     _set({
                //         status: 'Error',
                //         error: {
                //             code: 5031,
                //             message: "Opera web3 implementation is non-standard, did you block our application or forgot to set up yoru wallet?",
                //         },
                //         readOnly: true
                //     });
                // } else {
                _set({
                    status: 'Opera_FailedChainId', // TODO use Locked but mention it is not readable ?
                    readOnly: _fallbackUrl ? true : undefined
                });
                // }
            } else {
                _set({
                    status: 'Error',
                    error: {
                        code: 5030,
                        message: "could not detect current chain",
                    },
                    readOnly: _fallbackUrl ? true : undefined
                });
            }
            log.info('failed to get chain Id');
            return $wallet;
        }

        if (isOperaWallet && !opera_enabled_before) {
            localStorage.setItem('opera_wallet_enabled', true);
            log.info('opera enabled saved');
        }
        _set({ chainId });

        if (_supportedChainIds && _supportedChainIds.indexOf(chainId) == -1) {
            let readOnly;
            if(_fallbackUrl) {
                _ethSetup = eth._setup(_fallbackUrl, ethereum, undefined, _fallbackUrl);
                const fallbackChainId = await eth.fetchChainId();
                if (_registerContracts) {
                    try {
                        const contractsInfo = await _registerContracts($wallet, fallbackChainId);
                        contracts = eth.setupContracts(contractsInfo);
                    } catch (e) {
                        log.error(`failed to setup contracts for chain ${fallbackChainId} using ${_fallbackUrl}`, e);
                        _set({
                            status: 'Error',
                            error: {
                                code: 5030,
                                message: `no contract deployed on chain ${fallbackChainId}`, // could try again
                            },
                            readOnly: true,
                        });
                        return;
                    }
                    
                }
                readOnly = true;
            }
            _set({
                chainNotSupported: true,
                requireManualChainReload: isOperaWallet,
                readOnly
            });
        } else {
            if (_ethSetup && _registerContracts) {
                const contractsInfo = await _registerContracts($wallet);
                contracts = eth.setupContracts(contractsInfo);
            }
        }

        await _fetchAccountAndWatch(ethereum, unlock);
        return $wallet;
    }

    async function _fetchAccountAndWatch(provider, autoUnlock) {
        let accounts;
        try {
            log.trace('getting accounts..');
            accounts = await withTimeout(2000, eth.fetchAccounts());
            log.trace(`accounts : ${accounts}`);
        } catch (e) {
            // TODO timeout error
            if(e.type == 'timeout') {
                throw e;
            }
            log.error('accounts', e);
            accounts = undefined;
        }
        if (accounts && accounts.length > 0) {
            let initialBalance;
            if(_fetchInitialBalance) {
                initialBalance = await _ethSetup.provider.getBalance(accounts[0]);
            }
            log.info('already READY');
            _set({
                address: accounts[0],
                status: 'Ready',
                initialBalance,
            });
        } else {
            if(autoUnlock) {
                await unlock();
            } else {
                _set({ status: 'Locked' });
            }
        }

        if (provider) {
            watch(provider);
        }
    }

    async function _useOrCreateLocalWallet(localKey) {
        if(_fallbackUrl) {
            _recordUse('local');
            let ethersWallet;
            if (localKey) {
                log.trace('using localkey', localKey);
                if(typeof localKey === 'string') {
                    ethersWallet = new Wallet(localKey); // do not save it on local Storage
                    await setupLocalWallet(ethersWallet);
                } else { // assume it to be a boolean and create a wallet if not there
                    let privateKey;
                    try {
                        privateKey = localStorage.getItem('__wallet_priv');
                    } catch(e) {}
                    if(privateKey && privateKey !== '') {
                        const ethersWallet = new Wallet(privateKey);
                        await setupLocalWallet(ethersWallet);
                    } else {
                        await createLocalWallet();
                    }
                }
            } else {
                // log.trace('ckecking localStorage key', localKey);
                let privateKey;
                try {
                    privateKey = localStorage.getItem('__wallet_priv');
                } catch(e) {}
                let ethersWallet;
                if(privateKey && privateKey !== '') {
                    // log.trace('found key');
                    ethersWallet = new Wallet(privateKey);
                }
                await setupLocalWallet(ethersWallet);
            }
        } else {
            throw new Error('need a fallbackUrl for local wallet'); // TODO pass it in local config ? or reuse ?
        }
        return $wallet;
    }

    async function logout() {
        if ($wallet.walletChosen == 'builtin') {
            if ($wallet.walletChoice.length == 1 || _onlyBuiltin) {
                _set({
                    status: 'Locked',
                    address: undefined,
                });
            } else {
                try{
                    localStorage.removeItem('__last_wallet_used');
                }catch(e){}
                _set({
                    status: 'WalletToChoose',
                    address: undefined,
                    walletChosen: undefined,
                    isLocal: false
                });
            }
        } else if($wallet.walletChosen == 'local') {
            try{
                localStorage.removeItem('__last_wallet_used');
            }catch(e){}
            if ($wallet.walletChoice.length > 1 && !_onlyLocal) {
                _set({
                    status: 'WalletToChoose',
                    address: undefined,
                    walletChosen: undefined,
                    isLocal: undefined
                });
            }
        } else {
            try{
                localStorage.removeItem('__last_wallet_used');
            }catch(e){}
            const walletModule = _registeredWalletTypes[$wallet.walletChosen];
            if (walletModule && walletModule.logout) {
                await walletModule.logout();
            }
            _set({
                status: 'WalletToChoose',
                address: undefined,
                walletChosen: undefined,
                isLocal: undefined
            });
        }
    }

    async function use(walletTypeId, loadingTime) {
        if(!loadingTime) {
            _set({status: 'SettingUpWallet'});
        }
        log.trace('using walletType', walletTypeId);
        const walletType = _registeredWalletTypes[walletTypeId];
        if (!walletType) {
            throw new Error('wallet type ' + walletType + ' not  registered for use');
        }
        if(walletTypeId == 'builtin') {
            return _useBuiltinWallet(_ethereum, true); // TODO ethereum;
        } else if (walletTypeId == 'local') {
            return _useOrCreateLocalWallet(true); // TODO
        }
        _recordUse(walletTypeId);
        let chainId;
        if(_fallbackUrl) {
            _ethSetup = eth._setup(_fallbackUrl, undefined, undefined, _fallbackUrl);
            chainId = await eth.fetchChainId();
        }
        if (!chainId) {
            chainId = _supportedChainIds[0]; // TODO explicit chainId to use as defaukt ?
        }
        log.trace('setting up wallet module on chain ' + chainId);
        const result = await walletType.setup({chainId, fallbackUrl: _fallbackUrl});
        const {web3Provider, accounts} = result;
        _set({ chainId });
        log.trace('setting up web3 provider');
        // TODO record chainId //assume module us behaving correctly
        _ethSetup = eth._setup(web3Provider, undefined, undefined, _fallbackUrl); // TODO check if eth._setup assume builtin behaviour ?
        log.trace('fetching accounts');
        if (_ethSetup && _registerContracts) {
            const contractsInfo = await _registerContracts($wallet);
            contracts = eth.setupContracts(contractsInfo);
        }
        try {
            await _fetchAccountAndWatch(web3Provider);
        } catch(e) {
            _set({
                status: 'WalletToChoose',
                error: {type: 'timeout', message: 'cannot fetch account'}
            });
        }
        
    }

    async function _load({ 
        fallbackUrl,
        autoLocalIfBuiltinNotAvailable,
        autoBuiltinIfOnlyLocal,
        removeBuiltinFromChoiceIfNotPresent,
        reuseLastWallet,
        supportedChainIds,
        registerContracts,
        walletTypes,
        fetchInitialBalance
    }, isRetry) {
        _fallbackUrl = fallbackUrl;
        _registerContracts = registerContracts;
        _fetchInitialBalance = fetchInitialBalance;
        _supportedChainIds = supportedChainIds; // TODO clone ?
        _set({ status: 'Loading', _supportedChainIds });
        if (isRetry) { // this only concern builtin wallets // TODO rename ? or use `use('builtin')` instead of retry flow ?
            walletTypes = ['builtin'];
        }
        if(!walletTypes) {
            walletTypes = ['builtin'];
        } else if (typeof walletTypes == 'string') {
            walletTypes = [walletTypes];
        }

        try {
            _ethereum = await fetchEthereum();
        } catch(e) {
            log.error('error getting access to window.ethereum' , e);
            // TODO error or not ? // TODO potentialError vs criticalError
        }
        const vendor = getWalletVendor(_ethereum);
        const builtinWalletPresent = vendor ? vendor : false;

        const allWalletTypes = [];
        for (const walletType of walletTypes) {
            let walletTypeId;
            if(typeof walletType == 'string') {
                walletTypeId = walletType;
            } else {
                walletTypeId = walletType.id;
            }
            if (!(removeBuiltinFromChoiceIfNotPresent && walletTypeId == 'builtin' && !builtinWalletPresent)) {
                _registeredWalletTypes[walletTypeId] = walletType;
                allWalletTypes.push(walletType);
            }
        }
        let lastWalletUsed;
        if (reuseLastWallet) {
            try{
                lastWalletUsed = localStorage.getItem('__last_wallet_used');
            } catch(e){}
        }
        if (lastWalletUsed && !_registeredWalletTypes[lastWalletUsed]) { // allow recover even if configuration change
            if(lastWalletUsed == 'builtin' || lastWalletUsed == 'local') {
                allWalletTypes.push(lastWalletUsed);
                _registeredWalletTypes[lastWalletUsed] = lastWalletUsed;
            } else {
                console.error('cannot reuse wallet type', lastWalletUsed);
                 // TODO error
            }
        }

        if (!_registeredWalletTypes['local']) {
            let privateKey;
            try {
                privateKey = localStorage.getItem('__wallet_priv');
            } catch(e) {}
            if (privateKey) {
                const walletType = {id: 'local', privateKey};
                _registeredWalletTypes['local'] = walletType;
                allWalletTypes.push(walletType);
            }
        }

        const walletChoice = [];
        let onlyBuiltInAndLocal = true;
        let builtInInThere = false;
        let localInThere = false;
        for (const walletType of allWalletTypes) {
            let walletTypeId;
            if(typeof walletType == 'string') {
                walletTypeId = walletType;
            } else {
                walletTypeId = walletType.id;
            }
            if (walletTypeId == 'local') {
                localInThere = true;
            } else if (walletTypeId == 'builtin') {
                builtInInThere = true;
            } else {
                onlyBuiltInAndLocal = false;
            }
            walletChoice.push(walletTypeId);
        }
        onlyBuiltInAndLocal = onlyBuiltInAndLocal && builtInInThere && localInThere;

        _onlyLocal = autoLocalIfBuiltinNotAvailable && onlyBuiltInAndLocal && !builtinWalletPresent;
        _onlyBuiltin = autoBuiltinIfOnlyLocal && onlyBuiltInAndLocal && builtinWalletPresent;

        _set({
            builtinWalletPresent,
            walletChoice
        });
        
        let walletTypeToUse;
        if(lastWalletUsed) {
            walletTypeToUse = lastWalletUsed;
            if(lastWalletUsed == 'builtin') {
                if(!builtinWalletPresent) {
                    console.error('no builtin wallet present anymore');
                    walletTypeToUse = undefined; // TODO error
                }
            }
        }
        if (!walletTypeToUse) {
            if (allWalletTypes.length == 1) {
                walletTypeToUse = allWalletTypes[0].id || allWalletTypes[0];
            } else if (_onlyLocal) {
                walletTypeToUse = 'local';
            } else if (_onlyBuiltin) {
                walletTypeToUse = 'builtin';
            }
        }
        
        if (walletTypeToUse) {
            if(walletTypeToUse == 'builtin') {
                if(builtinWalletPresent) {
                    return _useBuiltinWallet(_ethereum, false, isRetry);
                } else {
                    if(_fallbackUrl) {
                        await setupLocalWallet(undefined); // TODO rename
                    } else {
                        _set({
                            status: 'NoWallet',
                        });
                    }
                }
            } else if (walletTypeToUse == 'local') {
                return _useOrCreateLocalWallet(_registeredWalletTypes['local'].localKey || true);
            } else {
                use(walletTypeToUse, true);
            }
        } else {
            if (_onlyBuiltin && !builtinWalletPresent) {
                _set({
                    status: 'NoWallet',
                });
            } else if (allWalletTypes.length > 0) {
                _set({
                    status: 'WalletToChoose',
                });
            } else {
                _set({
                    status: 'NoWallet',
                });
            }
        }
        return $wallet;
    }

    let promise;
    let _retry;
    async function load(config) {
        if (!process.browser) {
            _set({ status: 'Loading' });
            return $wallet;
        }
        if (promise) {
            return promise;
        }
        if(!config) {
            config = {};
        }
        _retry = (isRetry) => _load(config, isRetry);
        promise = _retry(false);
        return promise;
    }

    function call(options, contract, methodName, ...args) {
        // cal with from ?

        // const w = await ensureEnabled();
        // if (!w || !w.address) {
        //     throw new Error('Can\'t perform tx');
        // }
        if (typeof options === 'string') {
            if(typeof methodName !== 'undefined') {
                args.unshift(methodName);
            }
            methodName = contract;
            contract = options;
            options = undefined;
        }

        if (typeof args === 'undefined') {
            args = [];
        }

        if (contract) {
            const ethersContract = contracts[contract];
            const method = ethersContract.callStatic[methodName].bind(ethersContract);
            if(args.length > 0) {
                return method(...args, options || {}); // || defaultOptions);
            } else {
                return method(options || {}); // || defaultOptions);
            }
        } else {
            log.error('TODO send raw call');
        }
    }

    async function unlock() {
        log.info('Requesting unlock');
        _set({
            status: 'Unlocking'
        });
        let accounts;
        // try {
        //     accounts = await eth.fetchAccounts();
        // } catch (e) {
        //     log.info('cannot get accounts', e);
        //     accounts = [];
        // }
        // if (!accounts || accounts.length == 0) {
        // log.info('no accounts');
        try {
            log.trace('ethereum.enable...');
            accounts = await _ethSetup.web3Provider.enable();
            log.trace(`accounts : ${accounts}`);
        } catch (e) {
            log.info('refused to get accounts', e);
            // try {
            //     log.info('trying accounts...', e);
            //     accounts = await window.web3.eth.getAccounts();
            // } catch(e) {
            //     log.info('no accounts', e);
            accounts = [];
            // }
        }
        // }

        if (accounts.length > 0) {
            let initialBalance;
            if(_fetchInitialBalance) {
                initialBalance = await _ethSetup.provider.getBalance(accounts[0]);
            }
            log.info('unlocked READY');
            _set({
                address: accounts[0],
                status: 'Ready',
                initialBalance,
            });
        } else {
            _set({
                status: 'Locked'
            });
            return false;
        }

        return true;
    }

    async function ensureEnabled() {
        if ($wallet.status === 'Locked') { // TODO check race condition 'Unlocking' // queue tx requests ?
            await unlock();
        }
        return $wallet;
    }
    
    async function setupLocalWallet(ethersWallet, resetZeroWallet) {
        log.trace('setting up local wallet...', ethersWallet);
        _ethSetup = eth._setup(_fallbackUrl, null, ethersWallet ? ethersWallet.privateKey : undefined, _fallbackUrl);
        
        // if(ethersWallet && resetZeroWallet) { // TODO if dev
        //     const balance = await _ethSetup.provider.getBalance(ethersWallet.address);
        //     const nonce = await _ethSetup.provider.getTransactionCount(ethersWallet.address);
        //     if(balance.eq(0) && nonce === 0) {
            //         localStorage.removeItem('__wallet_priv');
        //         log.trace('zero wallet detected, reseting...');
        //         if(resetZeroWallet.createNew) {
        //             log.trace('creating a new wallet');
        //             await createLocalWallet()
        //             return;
        //         } else {
        //             log.trace('deleting wallet');
        //             ethersWallet = undefined;
        //         }
        //     }
        // }
         
        let chainId;
        try {
            log.trace('fetching chainId from fallback...');
            chainId = await eth.fetchChainId();
            log.trace(`chainId : ${chainId}`);
        } catch (e) {
            log.error('fallback : error fetching chainId', e);
        }
        if (chainId) {
            _set({chainId});
            if (_registerContracts) {
                try {
                    const contractsInfo = await _registerContracts($wallet);
                    contracts = eth.setupContracts(contractsInfo);
                } catch (e) {
                    log.error(`failed to setup contracts for chain ${chainId} using ${_fallbackUrl}`, e);
                    _set({
                        status: 'Error',
                        error: {
                            code: 5030,
                            message: `no contract deployed on chain ${chainId}`, // could try again
                        },
                        readOnly: true,
                    });
                    return;
                }
            }
            if (ethersWallet) {
                const hasPrivateModeRisk = await isPrivateWindow();
                let initialBalance;
                if(_fetchInitialBalance) {
                    initialBalance = await _ethSetup.provider.getBalance(ethersWallet.address);
                }
                _set({
                    address: ethersWallet.address,
                    status: 'Ready',
                    isLocal: true,
                    hasPrivateModeRisk: hasPrivateModeRisk ? true : undefined,
                    initialBalance,
                });
            } else {
                _set({
                    status: 'NoWallet',
                    readOnly: true
                });
            }
        } else {
            _set({
                status: 'Error',
                error: {
                    code: 5030,
                    message: "could not detect current chain", // could try again
                },
                readOnly: ethersWallet ? undefined : true,
            });
        }
    }

    async function createLocalWallet() {
        _set({status: 'CreatingLocalWallet'});
        log.trace('creating new wallet...');
        // TODO test over builtInWallet ?
        let privateKey;
        try {
            privateKey = localStorage.getItem('__wallet_priv');
        } catch(e) {}
        if(privateKey && privateKey !== '') {
            throw new Error('cannot override existing local wallet');
        }
        const ethersWallet = Wallet.createRandom();
        try {
            localStorage.setItem('__wallet_priv', ethersWallet.privateKey);
        } catch(e) {
            throw new Error('cannot save local wallet');
        }
        await setupLocalWallet(ethersWallet);
    }

    async function computeData(contract, methodName, ...args) {
        if (typeof args === 'undefined') {
            args = [];
        }

        const ethersContract = contracts[contract];
        const data = ethersContract.populateTransaction[methodName](...args);
        return data;
    }

    async function tx(options, contract, methodName, ...args) {
        const w = await ensureEnabled();
        if (!w || !w.address) {
            throw new Error('Can\'t perform tx'); // TODO more meaningful answer (user rejected?)
        }
        if (typeof options === 'string') {
            if(typeof methodName !== 'undefined') {
                args.unshift(methodName);
            }
            methodName = contract;
            contract = options;
            options = undefined;
        }

        options = options || {};
        if(options.gas) {
            options.gasLimit = options.gas;
            delete options.gas;
        }

        if (typeof args === 'undefined') {
            args = [];
        }

        if(options.from && options.from.toLowerCase() !== $wallet.address.toLowerCase()) {
            throw new Error('from != wallet.address')
        }
        delete options.from;

        let tx;
        if (contract) {
            const ethersContract = contracts[contract];
            const method = ethersContract[methodName].bind(ethersContract);
            
            if(!$wallet.isLocal) { // TODO add confirmation screens for burner wallet
                _set({
                    requestingTx: true,
                });
            }
            try {
                log.trace(`tx ${methodName}: ${args}`);
                const balance = await eth.getBalance($wallet.address);
                if (balance.eq(0)) { // TODO full balance check
                    throw new Error('not enough balance'); // TODO ensure error message passes through
                }
                tx = await method(...args, options); // || defaultOptions);
                log.trace(tx);
            } catch (e) {
                log.error('error making tx', e);
                tx = null; // TODO show error if not a user denial
            } finally {
                _set({
                    requestingTx: false,
                });
            }
            if(tx) {
                const pendingTx = {
                    hash: tx.hash,
                    contractName: contract,
                    methodName,
                    args,
                    options
                };
                emitTransaction(pendingTx, $wallet.chainId, $wallet.address);
            }
        } else {
            log.error('TODO send raw tx');
        }
        return tx;
    }

    async function sign(msgParams) {
        const w = await ensureEnabled();
        if (!w || !w.address) {
            throw new Error('Can\'t sign message'); // TODO more meaningful answer (user rejected?)
        }
        var params = [w.address, msgParams];
        var method = 'eth_signTypedData_v3';
        _set({
            requestingTx: true,
        });
        let response;
        try {
            response = await _ethSetup.provider.send(method, params);
        } catch(e) {
            log.error('error making tx', e);
            response = null;
        } finally {
            _set({
                requestingTx: false, // TODO rename
            });
        }
        return response;
    }

    function emitTransaction(tx, chainId, address) {
        for (let callback of transactionCallbacks) {
            callback(tx, chainId, address);
        }
    }

    const transactionCallbacks = [];
    function onTransactionBroadcasted(callback) {
        transactionCallbacks.push(callback);
    }

    return {
        load,
        retry,
        unlock,
        subscribe,
        onTransactionBroadcasted,
        tx,
        computeData,
        sign,
        call,
        createLocalWallet,
        use,
        logout,
        getProvider: () => _ethSetup.provider,
        getFallbackProvider: () => _ethSetup.fallbackProvider,
        reloadPage: () => reloadPage('requested', true),
        getContract: (name) => {
            const ethersContract = contracts[name];
            if(ethersContract) {
                return {
                    abi: ethersContract.interface.fragments,
                    address: ethersContract.address,
                };
            }
        }
    };
};

export default index;
