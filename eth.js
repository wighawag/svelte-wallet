import * as ethers from 'ethers';

let contracts = {};
let provider;
let signer;
let builtinProvider;

export default {
    _setup: (web3ProviderOrURL, web3Provider, privateKey) => { // TODO rename web3Provider/web3ProviderOrURL to web3Provider/...
        let web3ProviderGiven;
        contracts = {};
        provider = undefined;
        signer = undefined;
        builtinProvider = undefined;
        if (typeof web3ProviderOrURL === 'string') {
            provider = new ethers.providers.JsonRpcProvider(web3ProviderOrURL);
            if (privateKey) {
                signer = new ethers.Wallet(privateKey);
                signer = signer.connect(provider);
                builtinProvider = provider;
            } else if (web3Provider) {
                builtinProvider = new ethers.providers.Web3Provider(web3Provider);
                web3ProviderGiven = web3Provider;
            } else {
                builtinProvider = provider;
            }
        } else {
            provider = new ethers.providers.Web3Provider(web3ProviderOrURL);
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
            web3Provider: web3ProviderGiven
        };
    },
    fetchChainId: () => {
        return provider.send('eth_chainId').then((result) => {
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
        return builtinProvider.send('eth_chainId').then((result) => {
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
            contracts[key] = new ethers.Contract(info.address, info.contractInfo.abi, signer || provider);
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
