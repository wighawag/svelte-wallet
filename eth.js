import * as ethers from 'ethers';

let contracts = {};
let provider;
let signer;
let builtinProvider;

export default {
    _setup: (ethereumOrURL, ethereum, privateKey) => {
        contracts = {};
        provider = undefined;
        signer = undefined;
        builtinProvider = undefined;
        if (typeof ethereumOrURL === 'string') {
            provider = new ethers.providers.JsonRpcProvider(ethereumOrURL);
            if (privateKey) {
                signer = new ethers.Wallet(privateKey);
                signer = signer.connect(provider);
                builtinProvider = provider;
            } else if (ethereum) {
                builtinProvider = new ethers.providers.Web3Provider(ethereum);
            } else {
                builtinProvider = provider;
            }
        } else {
            provider = new ethers.providers.Web3Provider(ethereumOrURL);
            builtinProvider = provider;
            signer = provider.getSigner();
        }

        // TODO remove (debug)
        window.provider = provider;
        window.signer = signer;
        window.builtinProvider = builtinProvider;
        return {
            provider,
            signer,
            builtinProvider,
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
