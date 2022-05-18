import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { PublicKey, ConfirmedSignatureInfo, Connection } from "@solana/web3.js";
import {
  getRealms,
  getRealm,
  getAllTokenOwnerRecords, // returns all members of a realm, 1 token record for community or council holding
  getVoteRecordsByVoter, // get all votes a member did
  getGovernanceChatMessagesByVoter,
  GOVERNANCE_CHAT_PROGRAM_ID,
} from "@solana/spl-governance";

import {
  REALM_GOVERNANCE_PKEY,
  RPC_CONNECTION,
  INDEX_RPC_CONNECTION,
} from "../constants/Solana";
import { formatVoteWeight } from "../utils";

interface genericObj {
  [key: string]: any;
}

export interface realmState {
  members: Array<Member>;
  membersMap: any;
  memberChat: Array<ChatMessage>;
  memberVotes: Array<MemberVote>;
  isLoadingMembers: boolean;
  isLoadingChat: boolean;
  isLoadingVotes: boolean;
  isRefreshingMembers: boolean;
  delegateMap: any;
  tokenRecordToWalletMap: genericObj;
}

const initialState: realmState = {
  members: [],
  membersMap: null,
  memberChat: [],
  memberVotes: [],
  isLoadingMembers: false,
  isLoadingChat: false,
  isLoadingVotes: false,
  isRefreshingMembers: false,
  delegateMap: {},
  tokenRecordToWalletMap: {},
};

let connection = new Connection(RPC_CONNECTION, "confirmed");
const indexConnection = new Connection(INDEX_RPC_CONNECTION, "recent");

// TODO: map tokenRecord -> walletid
//

export const fetchRealmMembers = createAsyncThunk(
  "realms/fetchRealmMembers",
  async ({ realm }: any) => {
    try {
      let rawTokenOwnerRecords;

      rawTokenOwnerRecords = await getAllTokenOwnerRecords(
        indexConnection,
        new PublicKey(realm.governanceId),
        new PublicKey(realm.pubKey)
      );

      const {
        councilMint,
        communityMint,
        communityMintDecimals,
        councilMintDecimals,
      } = realm;

      const membersMap = {};
      const delegateMap = {};
      const tokenRecordToWalletMap = {} as genericObj;

      rawTokenOwnerRecords?.map((member) => {
        // if member does not exist, add member to member map
        // if member does exist, check which token record this is and add correct attributes to object

        const governingTokenMint = member.account.governingTokenMint.toString();
        const depositAmount =
          member.account.governingTokenDepositAmount.toString();

        let memberData = {
          publicKey: member.pubkey.toString(),
          owner: member.owner.toString(), // RealmId
          totalVotesCount: member.account.totalVotesCount, // How many votes they have
          outstandingProposalCount: member.account.outstandingProposalCount,
          walletId: member.account.governingTokenOwner.toString(), // Wallet address of owner of dao token
        };
        tokenRecordToWalletMap[member.pubkey.toString()] =
          member.account.governingTokenOwner.toString();

        if (governingTokenMint === councilMint) {
          const delegateWalletId =
            member?.account?.governanceDelegate?.toBase58();
          // @ts-ignore
          memberData["councilPublicKey"] = member.pubkey.toString();
          // @ts-ignore
          memberData["councilDelegate"] = delegateWalletId;
          // @ts-ignore
          memberData["totalVotesCouncil"] = member.account.totalVotesCount;
          // @ts-ignore
          memberData["councilTokenMint"] = governingTokenMint;
          // @ts-ignore
          memberData["councilDepositAmount"] = depositAmount;
          // @ts-ignore
          memberData["councilDepositUiAmount"] = formatVoteWeight(
            depositAmount,
            councilMintDecimals
          );

          if (delegateWalletId) {
            if (delegateMap[delegateWalletId]) {
              const oldCouncilRecords =
                delegateMap[delegateWalletId]?.councilMembers || [];

              delegateMap[delegateWalletId] = {
                ...delegateMap[delegateWalletId],
                councilMembers: [...oldCouncilRecords, memberData],
              };
            } else {
              delegateMap[delegateWalletId] = {
                councilMembers: [memberData],
              };
            }
          }
        } else {
          const delegateWalletId =
            member?.account?.governanceDelegate?.toBase58();

          //@ts-ignore
          memberData["communityPublicKey"] = member.pubkey.toString();
          // @ts-ignore
          memberData["communityDelegate"] = delegateWalletId;
          // @ts-ignore
          memberData["totalVotesCommunity"] = member.account.totalVotesCount;
          // @ts-ignore
          memberData["communityTokenMint"] = governingTokenMint;
          // @ts-ignore
          memberData["communityDepositAmount"] = depositAmount;
          //@ts-ignore
          memberData["communityDepositUiAmount"] = formatVoteWeight(
            depositAmount,
            communityMintDecimals
          );

          if (delegateWalletId) {
            if (delegateMap[delegateWalletId]) {
              const oldCommunityRecords =
                delegateMap[delegateWalletId]?.communityMembers || [];

              delegateMap[delegateWalletId] = {
                ...delegateMap[delegateWalletId],
                communityMembers: [...oldCommunityRecords, memberData],
              };
            } else {
              delegateMap[delegateWalletId] = {
                communityMembers: [memberData],
              };
            }
          }
        }

        // If we get 2 token owners for the same id, merge them together so we can access both tokens they own
        // @ts-ignore
        const possibleMember = membersMap[memberData.walletId];
        // @ts-ignore
        membersMap[memberData.walletId] = possibleMember
          ? { ...possibleMember, ...memberData }
          : memberData;

        return memberData;
      });

      // console.log("tokenOwnerLength", rawTokenOwnerRecords?.length);
      // console.log("member map length", Object.keys(membersMap).length);
      const members = Object.values(membersMap);
      const sortedMembers = members?.sort(
        // @ts-ignore
        (a, b) => b?.totalVotesCount - a?.totalVotesCount
      );

      return {
        members: sortedMembers,
        membersMap: membersMap,
        delegateMap: delegateMap,
        tokenRecordToWalletMap: tokenRecordToWalletMap,
      };
    } catch (error) {
      console.log("error", error);
    }
  }
);

export const fetchMemberChat = createAsyncThunk(
  "realms/fetchMemberChat",
  async (member: Member) => {
    let rawChatMesssages;

    try {
      rawChatMesssages = await getGovernanceChatMessagesByVoter(
        indexConnection,
        GOVERNANCE_CHAT_PROGRAM_ID,
        new PublicKey(member.walletId)
      );
      // console.log("raw messages", rawChatMesssages);
      let parsedChatMessages = rawChatMesssages.map((message) => {
        return {
          postedAt: message.account.postedAt.toNumber(),
          replyTo: message.account.replyTo?.toString() || null,
          proposalId: message.account.proposal.toString(),
          body: message.account.body.value,
          author: message.account.author.toString(),
          isReply: message.account.body.isReply,
          isReaction: message.account.body.type === 0,
        };
      });

      parsedChatMessages = parsedChatMessages?.sort(
        (a, b) => b.postedAt - a.postedAt
      );

      return parsedChatMessages;
    } catch (error) {
      console.log("error", error);
    }

    return [];
  }
);

export const fetchMemberVotes = createAsyncThunk(
  "realms/fetchMemberVotes",
  async ({ member, realm }: any) => {
    let rawVoteRecords;

    try {
      rawVoteRecords = await getVoteRecordsByVoter(
        indexConnection,
        new PublicKey(realm.governanceId), // change this based on the dao program id
        new PublicKey(member.walletId)
      );

      let parsedVoteRecords = rawVoteRecords.map((vote) => {
        return {
          proposalId: vote.account.proposal.toString(),
          isRelinquished: vote.account.isRelinquished,
          voterWeightNo: vote.account.getNoVoteWeight()?.toString(),
          voteWeightYes: vote.account.getYesVoteWeight()?.toString(),
        };
      });
      // console.log("raw vote records", rawVoteRecords);

      return parsedVoteRecords;
    } catch (error) {
      console.log("error", error);
    }

    return [];
  }
);

export const memberSlice = createSlice({
  name: "realms",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchRealmMembers.pending, (state, action) => {
        if (action?.meta?.arg?.isRefreshing) {
          state.isRefreshingMembers = true;
        } else {
          state.isLoadingMembers = true;
        }
      })
      .addCase(fetchRealmMembers.rejected, (state) => {
        state.isLoadingMembers = false;
      })
      .addCase(fetchRealmMembers.fulfilled, (state, action: any) => {
        state.isLoadingMembers = false;
        state.isRefreshingMembers = false;
        state.membersMap = action.payload.membersMap;
        state.members = action.payload.members;
        state.delegateMap = action.payload.delegateMap;
        state.tokenRecordToWalletMap = action.payload.tokenRecordToWalletMap;
      })
      .addCase(fetchMemberChat.pending, (state) => {
        state.isLoadingChat = true;
      })
      .addCase(fetchMemberChat.rejected, (state) => {
        state.isLoadingChat = false;
      })
      .addCase(fetchMemberChat.fulfilled, (state, action: any) => {
        state.isLoadingChat = false;
        state.memberChat = action.payload;
      })
      .addCase(fetchMemberVotes.pending, (state) => {
        state.isLoadingVotes = true;
      })
      .addCase(fetchMemberVotes.rejected, (state) => {
        state.isLoadingVotes = false;
      })
      .addCase(fetchMemberVotes.fulfilled, (state, action: any) => {
        state.isLoadingVotes = false;
        state.memberVotes = action.payload;
      });
  },
});

export const {} = memberSlice.actions;

export default memberSlice.reducer;
